// ============================================
// CONSTANTS & STATE
// ============================================
let group_update_timeout;
const DEBOUNCE_DELAY = 300;

// ============================================
// PARENT: Furniture Summary
// ============================================
frappe.ui.form.on("Furniture Summary", {
    refresh(frm) {
        updateTotals(frm);
        
        if (!frm.is_new()) {
            frm.add_custom_button(__('Get Items From'), () => {
                showSourceDialog(frm);
            });
        }
    },
    
    before_save(frm) {
        return refreshItemsFromFurniture(frm).then(() => updateGroupItems(frm, true));
    },
    
    items_add(frm, cdt, cdn) {
        recalcRow(frm, cdt, cdn);
        debounceUpdateGroupItems(frm);
    },
    
    items_remove(frm) {
        updateTotals(frm);
        debounceUpdateGroupItems(frm);
    }
});

// ============================================
// CHILD: Furniture Summary Items
// ============================================
frappe.ui.form.on("Furniture Summary Items", {
    form_render(frm, cdt, cdn) {
        recalcRow(frm, cdt, cdn);
        debounceUpdateGroupItems(frm);
    },
    
    rate_per_unit(frm, cdt, cdn) {
        recalcRow(frm, cdt, cdn);
        debounceUpdateGroupItems(frm);
    },
    
    margin(frm, cdt, cdn) {
        recalcRow(frm, cdt, cdn);
        debounceUpdateGroupItems(frm);
    },
    
    qty(frm, cdt, cdn) {
        recalcRow(frm, cdt, cdn);
        debounceUpdateGroupItems(frm);
    },
    
    furniture(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (!row.furniture) {
            recalcRow(frm, cdt, cdn);
            debounceUpdateGroupItems(frm);
            return;
        }

        frappe.call({
            method: "frappe.client.get",
            args: {
                doctype: "Furniture Costing",
                name: row.furniture
            },
            callback(r) {
                if (!r.message) return;
                
                const { dvt = "", rate_per_unit = 0, margin = 0 } = r.message;
                
                frappe.model.set_value(cdt, cdn, {
                    dvt,
                    rate_per_unit,
                    margin
                });

                recalcRow(frm, cdt, cdn);
                debounceUpdateGroupItems(frm);
            }
        });
    }
});

// ============================================
// CALCULATION FUNCTIONS
// ============================================
function recalcRow(frm, cdt, cdn) {
    const row = locals[cdt][cdn];
    if (!row) return;
    
    const rate_per_unit = parseFloat(row.rate_per_unit) || 0;
    const margin = parseFloat(row.margin) || 0;
    const qty = parseFloat(row.qty) || 0;

    const denom = 1 - (margin / 100.0);
    const rate_bg = denom !== 0 ? (rate_per_unit / denom) : 0;
    const amount = qty * rate_bg;

    frappe.model.set_value(cdt, cdn, {
        rate_bg,
        amount
    });

    updateTotals(frm);
}

function updateTotals(frm) {
    const items = frm.doc.items || [];
    
    let total_amount = 0;
    let total_cost = 0;
    
    items.forEach(row => {
        total_amount += parseFloat(row.amount) || 0;
        
        const rate = parseFloat(row.rate_per_unit) || 0;
        const qty = parseFloat(row.qty) || 0;
        total_cost += rate * qty;
    });
    
    frm.set_value({
        total_amount,
        total_cost
    });
}

async function refreshItemsFromFurniture(frm) {
    const items = (frm.doc.items || []).filter(it => it.furniture && it.furniture.trim() !== "");
    if (items.length === 0) return Promise.resolve();

    const requests = items.map(item => 
        frappe.call({
            method: "frappe.client.get",
            args: {
                doctype: "Furniture Costing",
                name: item.furniture
            }
        }).then(res => {
            if (!res.message) return;
            const { dvt = "", rate_per_unit = 0, margin = 0 } = res.message;
            return frappe.model.set_value(item.doctype, item.name, {
                dvt,
                rate_per_unit,
                margin
            });
        }).catch(err => {
            console.error(`Error refreshing furniture ${item.furniture}:`, err);
        })
    );

    await Promise.all(requests);

    items.forEach(item => recalcRow(frm, item.doctype, item.name));
    updateTotals(frm);
    return Promise.resolve();
}

// ============================================
// GROUP ITEMS UPDATE
// ============================================
function debounceUpdateGroupItems(frm) {
    clearTimeout(group_update_timeout);
    group_update_timeout = setTimeout(() => {
        updateGroupItems(frm, false);
    }, DEBOUNCE_DELAY);
}

async function updateGroupItems(frm, isSync = false) {
    const valid_items = (frm.doc.items || []).filter(
        it => it.furniture && it.furniture.trim() !== ''
    );

    if (valid_items.length === 0) {
        frm.clear_table("group");
        frm.refresh_field("group");
        return Promise.resolve();
    }

    try {
        const promises = valid_items.map(item => 
            fetchGroupItemsFromFurniture(item.furniture, item.qty)
        );

        const results = await Promise.all(promises);
        const aggregated = aggregateGroupItems(results);
        
        populateGroupTable(frm, aggregated);
        
        return Promise.resolve();
    } catch (err) {
        console.error('Error updating group items:', err);
        frappe.msgprint({
            title: __('Error'),
            indicator: 'red',
            message: __('Failed to update group items. Please try again.')
        });
        return Promise.reject(err);
    }
}

function fetchGroupItemsFromFurniture(furniture_name, qty) {
    return new Promise((resolve, reject) => {
        frappe.call({
            method: "furnicost.furnicost.doctype.furniture_summary.furniture_summary.get_group_items_from_furniture",
            args: {
                furniture_name,
                summary_qty: parseFloat(qty) || 0
            },
            callback(res) {
                resolve(res.message || []);
            },
            error(err) {
                console.error(`Error fetching items for ${furniture_name}:`, err);
                resolve([]);
            }
        });
    });
}

function aggregateGroupItems(results) {
    const aggregated = {};
    
    results.flat().forEach(row => {
        const key = `${row.item_code}|${row.uom}|${row.rate}|${row.depth || 0}`;
        
        if (!aggregated[key]) {
            aggregated[key] = {
                item_code: row.item_code,
                uom: row.uom,
                depth: row.depth || 0,
                rate: row.rate,
                total_qty: 0,
                amount: 0
            };
        }
        
        const qty = parseFloat(row.total_qty) || 0;
        const rate = parseFloat(row.rate) || 0;
        
        aggregated[key].total_qty += qty;
        aggregated[key].amount += rate * qty;
    });
    
    return aggregated;
}

function populateGroupTable(frm, aggregated) {
    frm.clear_table("group");
    
    const total_cost = parseFloat(frm.doc.total_cost) || 1;
    const total_amount = parseFloat(frm.doc.total_amount) || 1;
    
    Object.values(aggregated).forEach(item => {
        const row = frm.add_child("group");
        Object.assign(row, {
            ...item,
            cost_ratio: (item.amount / total_cost) * 100,
            price_ratio: (item.amount / total_amount) * 100
        });
    });
    
    frm.refresh_field("group");
}

// ============================================
// GET ITEMS FROM PROJECT/CUSTOMER
// ============================================
function showSourceDialog(frm) {
    frappe.prompt([
        {
            fieldname: 'source_type',
            label: __('Get From'),
            fieldtype: 'Select',
            options: ['Project', 'Customer'],
            reqd: 1
        }
    ], (values) => {
        const source_type = values.source_type;
        const fieldname = source_type.toLowerCase();
        const value = frm.doc[fieldname];

        if (!value) {
            frappe.msgprint(__('Please set {0} before continuing', [source_type]));
            return;
        }

        fetchAndShowCostings(frm, fieldname, value);
    }, __('Get Items From'), __('Continue'));
}

function fetchAndShowCostings(frm, fieldname, value) {
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Furniture Costing",
            filters: { [fieldname]: value },
            fields: ["name", "furniture", "dvt", "rate_per_unit", "margin"],
            limit_page_length: 100
        },
        callback(r) {
            const records = r.message || [];
            
            if (records.length === 0) {
                frappe.msgprint(__('No Furniture Costing found'));
                return;
            }

            showCostingSelectionDialog(frm, records);
        }
    });
}

function showCostingSelectionDialog(frm, records) {
    const html = buildCostingTableHTML(records);
    
    const dialog = new frappe.ui.Dialog({
        title: __('Select Furniture Costings'),
        fields: [{ 
            fieldtype: 'HTML', 
            fieldname: 'costing_html' 
        }],
        primary_action_label: __('Select'),
        primary_action() {
            const selected = getSelectedCostings(dialog);
            
            if (selected.length === 0) {
                frappe.msgprint(__('Please select at least one record'));
                return;
            }
            
            addSelectedItemsToForm(frm, selected);
            dialog.hide();
        }
    });

    dialog.fields_dict.costing_html.$wrapper.html(html);
    dialog.show();
}

function buildCostingTableHTML(records) {
    const rows = records.map(r => `
        <tr>
            <td>
                <input type="checkbox"
                    data-furniture="${r.furniture || ""}"
                    data-dvt="${r.dvt || ""}"
                    data-rate="${r.rate_per_unit || 0}"
                    data-margin="${r.margin || 0}">
            </td>
            <td>${r.furniture || ""}</td>
            <td>${r.dvt || ""}</td>
            <td>${frappe.format(r.rate_per_unit || 0, {fieldtype: "Currency"})}</td>
            <td>${r.margin || 0}</td>
        </tr>
    `).join('');
    
    return `
        <style>
            .costing-table { 
                width: 100%; 
                border-collapse: collapse; 
            }
            .costing-table th, .costing-table td {
                border: 1px solid #ddd;
                padding: 8px;
                text-align: left;
            }
            .costing-table th { 
                background-color: #f5f5f5;
                font-weight: 600;
            }
            .costing-table tbody tr:hover {
                background-color: #f9f9f9;
            }
        </style>
        <table class="costing-table">
            <thead>
                <tr>
                    <th style="width: 60px;">Select</th>
                    <th>Furniture</th>
                    <th>ĐVT</th>
                    <th>Rate per Unit</th>
                    <th>Margin (%)</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
    `;
}

function getSelectedCostings(dialog) {
    const selected = [];
    
    dialog.$wrapper.find('input[type="checkbox"]:checked').each(function() {
        const $checkbox = $(this);
        selected.push({
            furniture: $checkbox.data("furniture"),
            dvt: $checkbox.data("dvt"),
            rate_per_unit: $checkbox.data("rate"),
            margin: $checkbox.data("margin")
        });
    });
    
    return selected;
}

function addSelectedItemsToForm(frm, items) {
    items.forEach(item => {
        const row = frm.add_child("items");
        Object.assign(row, item);
        if (row.qty === undefined || row.qty === null || row.qty === "") {
            row.qty = 1;
        }
        recalcRow(frm, row.doctype, row.name);
    });
    
    frm.refresh_field("items");
    debounceUpdateGroupItems(frm);
}
