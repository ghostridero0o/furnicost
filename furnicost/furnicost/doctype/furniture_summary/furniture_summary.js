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
        if (frm.doc.docstatus === 0) frm.add_custom_button(__("BOQ"), () => showBOQDialog(frm), __("Get Items From"));
        
        if (frm.doc.docstatus === 0) {
            frm.add_custom_button(__('Furniture Costing'), () => showFurnitureCostingDialog(frm), __('Get Items From'));
        }

        frm.add_custom_button(__('Update Items Summary'), () => {
            refreshItemsFromFurniture(frm).then(() => updateGroupItems(frm, false));
        });
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
            if (row.source_boq) row.rate_per_unit = 0;
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
                
                if (locals[cdt][cdn].furniture !== r.message.name) return;
                if (row.source_boq) {
                    if (normalizeBOQUom(row.dvt) !== normalizeBOQUom(dvt)) {
                        frappe.msgprint(__("Đơn vị BOQ và Furniture khác nhau. Vui lòng chọn Furniture cùng đơn vị."));
                        frappe.model.set_value(cdt, cdn, "furniture", "");
                        return;
                    }
                    row.rate_per_unit = rate_per_unit;
                } else {
                    frappe.model.set_value(cdt, cdn, {dvt, rate_per_unit, margin});
                }

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

    if (row.source_boq) {
        const price = flt(row.rate_bg);
        row.amount = qty * price;
        row.margin = row.furniture && price ? (1 - rate_per_unit / price) * 100 : 0;
        row.cost_status = !row.furniture ? "Chưa có giá vốn" : price ? "Đã có giá vốn" : "Giá báo bằng 0 — không tính % lãi";
        frm.refresh_field("items");
        updateTotals(frm);
        return;
    }
    const denom = 1 - (margin / 100.0);
    const rate_bg = denom !== 0 ? (rate_per_unit / denom) : 0;
    const amount = qty * rate_bg;

    frappe.model.set_value(cdt, cdn, {
        rate_bg,
        amount
    }, undefined, true);

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
    
    frm.set_value("total_amount", total_amount, null, true);
    frm.set_value("total_cost", total_cost, null, true);
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
            if (item.source_boq) {
                if (normalizeBOQUom(item.dvt) !== normalizeBOQUom(dvt)) {
                    frappe.throw(__("Đơn vị BOQ và Furniture khác nhau: {0}", [item.furniture]));
                }
                item.rate_per_unit = rate_per_unit;
                return;
            }
            return frappe.model.set_value(item.doctype, item.name, {dvt, rate_per_unit, margin}, undefined, true);
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
function showFurnitureCostingDialog(frm) {
    let requestId = 0;
    let ready = false;
    const dialog = new frappe.ui.Dialog({
        title: __('Furniture Costing'),
        size: 'extra-large',
        fields: [
            {fieldname: 'project', fieldtype: 'Link', options: 'Project', label: __('Project'), onchange: load},
            {fieldname: 'this_project', fieldtype: 'Check', label: __('This Project'),
                onchange: () => useCurrent('project')},
            {fieldtype: 'Column Break'},
            {fieldname: 'customer', fieldtype: 'Link', options: 'Customer', label: __('Customer'), onchange: load},
            {fieldname: 'this_customer', fieldtype: 'Check', label: __('This Customer'),
                onchange: () => useCurrent('customer')},
            {fieldtype: 'Section Break'},
            {fieldname: 'status', fieldtype: 'HTML'},
            {fieldname: 'costings', fieldtype: 'Table', label: __('Chọn Furniture Costing'),
                cannot_add_rows: true, cannot_delete_rows: true, data: [], fields: [
                    {fieldname: 'costing_name', fieldtype: 'Link', options: 'Furniture Costing', label: __('Furniture Costing'), in_list_view: 1, read_only: 1, columns: 3},
                    {fieldname: 'furniture', fieldtype: 'Data', label: __('Furniture'), in_list_view: 1, read_only: 1, columns: 3},
                    {fieldname: 'dvt', fieldtype: 'Data', label: __('ĐVT'), in_list_view: 1, read_only: 1, columns: 1},
                    {fieldname: 'rate_per_unit', fieldtype: 'Currency', label: __('Giá vốn'), in_list_view: 1, read_only: 1, columns: 2},
                    {fieldname: 'margin', fieldtype: 'Percent', label: __('Lãi gộp'), in_list_view: 1, read_only: 1, columns: 1}
                ]}
        ],
        primary_action_label: __('Thêm vào Summary'),
        primary_action() {
            const rows = dialog.fields_dict.costings.grid.get_selected_children();
            if (!rows.length) return frappe.msgprint(__('Vui lòng chọn ít nhất một dòng.'));
            addSelectedItemsToForm(frm, rows.map(row => ({
                furniture: row.costing_name, dvt: row.dvt,
                rate_per_unit: row.rate_per_unit, margin: row.margin
            })));
            frm.dirty();
            dialog.hide();
        }
    });
    async function useCurrent(field) {
        if (!ready) return;
        const checked = dialog.get_value('this_' + field);
        if (checked && !frm.doc[field]) {
            await dialog.set_value('this_' + field, 0);
            frappe.msgprint(__('Furniture Summary chưa có {0}.', [field === 'project' ? 'Project' : 'Customer']));
            return;
        }
        dialog.set_df_property(field, 'read_only', !!checked);
        await dialog.set_value(field, checked ? frm.doc[field] : '');
        await load();
    }
    async function load() {
        if (!ready) return;
        const id = ++requestId;
        const grid = dialog.fields_dict.costings.grid;
        grid.df.data = [];
        grid.refresh();
        dialog.get_primary_btn().prop('disabled', true);
        dialog.fields_dict.status.$wrapper.text(__('Đang tải…'));
        const filters = {};
        for (const field of ['project', 'customer']) {
            if (dialog.get_value(field)) filters[field] = dialog.get_value(field);
        }
        try {
            const rows = [];
            const pageSize = 100;
            for (let start = 0; ; start += pageSize) {
                const result = await frappe.call({method: 'frappe.client.get_list', args: {
                    doctype: 'Furniture Costing', filters,
                    fields: ['name', 'furniture', 'dvt', 'rate_per_unit', 'margin'],
                    order_by: 'name asc', limit_start: start, limit_page_length: pageSize
                }});
                if (id !== requestId) return;
                const page = result.message || [];
                rows.push(...page.map(row => ({...row, costing_name: row.name})));
                if (page.length < pageSize) break;
            }
            grid.df.data = rows;
            grid.refresh();
            dialog.fields_dict.status.$wrapper.text(rows.length
                ? __('{0} Furniture Costing. Chọn cả Project và Customer sẽ lọc theo cả hai điều kiện.', [rows.length])
                : __('Không có Furniture Costing phù hợp.'));
        } catch (error) {
            if (id === requestId) dialog.fields_dict.status.$wrapper.text(__('Không tải được dữ liệu. Vui lòng thử lại.'));
        } finally {
            if (id === requestId) dialog.get_primary_btn().prop('disabled', false);
        }
    }
    dialog.show();
    ready = true;
    load();
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


function normalizeBOQUom(value) {
    return String(value || "").toLowerCase().replace(/²/g, "2").replace(/³/g, "3").replace(/\s+/g, "");
}

function showBOQDialog(frm) {
    const dialog = new frappe.ui.Dialog({
        title: __("Lấy hạng mục từ BOQ"),
        size: "extra-large",
        fields: [
            {fieldname: "boq", fieldtype: "Link", options: "BOQ", label: "BOQ", reqd: 1,
                get_query: () => ({filters: {docstatus: ["!=", 2],
                    ...(frm.doc.project ? {project: frm.doc.project} : {}),
                    ...(frm.doc.customer ? {customer: frm.doc.customer} : {})}}),
                async onchange() {
                    const boq = dialog.get_value("boq");
                    dialog.fields_dict.rows.df.data = [];
                    dialog.fields_dict.rows.grid.refresh();
                    if (!boq) return;
                    const result = await frappe.call({
                        method: "furnicost.furnicost.doctype.furniture_summary.furniture_summary.get_boq_items",
                        args: {boq, project: frm.doc.project, customer: frm.doc.customer}
                    });
                    if (dialog.get_value("boq") !== boq) return;
                    dialog.fields_dict.rows.df.data = result.message || [];
                    dialog.fields_dict.rows.grid.refresh();
                }},
            {fieldname: "rows", fieldtype: "Table", label: __("Chọn hạng mục"),
                cannot_add_rows: true, cannot_delete_rows: true, data: [], fields: [
                    {fieldname:"boq_item_name", fieldtype:"Data", label:"Hạng mục", in_list_view:1, read_only:1},
                    {fieldname:"furniture", fieldtype:"Link", options:"Furniture Costing", label:"Furniture", in_list_view:1, read_only:1},
                    {fieldname:"dvt", fieldtype:"Data", label:"ĐVT", in_list_view:1, read_only:1},
                    {fieldname:"qty", fieldtype:"Float", label:"Khối lượng", in_list_view:1, read_only:1},
                    {fieldname:"rate_bg", fieldtype:"Currency", label:"Giá báo", in_list_view:1, read_only:1}
                ]}
        ],
        primary_action_label: __("Thêm vào Summary"),
        async primary_action() {
            const selected = dialog.fields_dict.rows.grid.get_selected_children();
            if (!selected.length) return frappe.msgprint(__("Vui lòng chọn ít nhất một dòng."));
            const existing = new Set((frm.doc.items || []).map(r => r.source_boq_item).filter(Boolean));
            let added = 0;
            for (const source of selected) {
                if (existing.has(source.source_boq_item)) continue;
                const row = frm.add_child("items");
                for (const key of ["source_boq", "source_boq_item", "boq_item_name", "furniture", "dvt", "rate_bg", "qty", "amount"]) row[key] = source[key];
                existing.add(source.source_boq_item);
                recalcRow(frm, row.doctype, row.name);
                added++;
            }
            frm.dirty();
            await refreshItemsFromFurniture(frm);
            frm.refresh_field("items");
            await updateGroupItems(frm, false);
            dialog.hide();
            frappe.show_alert({message: __("Đã thêm {0} dòng; bỏ qua các dòng đã có.", [added]), indicator: "green"});
        }
    });
    dialog.show();
}
