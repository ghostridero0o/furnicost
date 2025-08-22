// Parent: Furniture Summary
frappe.ui.form.on("Furniture Summary", {
    refresh(frm) {
        update_total_amount(frm);
        update_total_cost(frm);

        if (!frm.is_new()) {
            frm.add_custom_button(__('Get Items From'), () => {
                show_source_dialog(frm);
            });
        }
    },
    items_add(frm, cdt, cdn) {
        recalc_and_update(frm, cdt, cdn);
    },
    items_remove(frm) {
        update_total_amount(frm);
        update_total_cost(frm);
    }
});

// Child: Furniture Summary Items
frappe.ui.form.on("Furniture Summary Items", {
    form_render(frm, cdt, cdn) {
        recalc_and_update(frm, cdt, cdn);
    },
    rate_per_unit: recalc_and_update,
    margin: recalc_and_update,
    qty: recalc_and_update,
    furniture_part: recalc_and_update
});

// ---- Helpers ----

// Prompt chọn source: Project hoặc Customer
function show_source_dialog(frm) {
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

        if (!frm.doc[fieldname]) {
            frappe.msgprint(__('Please set {0} before continuing', [source_type]));
            return;
        }

        fetch_and_show_costings(frm, fieldname, frm.doc[fieldname]);
    }, __('Get Items From'), __('Continue'));
}

// Query danh sách Furniture Costing và show bảng
function fetch_and_show_costings(frm, fieldname, value) {
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Furniture Costing",
            filters: { [fieldname]: value },
            fields: ["name", "furniture", "dvt", "rate_per_unit"],
            limit_page_length: 100
        },
        callback(r) {
            const records = r.message || [];
            if (records.length === 0) {
                frappe.msgprint(__('No Furniture Costing found'));
                return;
            }

            // Build HTML table
            let html = `
                <style>
                    .costing-table { width: 100%; border-collapse: collapse; }
                    .costing-table th, .costing-table td {
                        border: 1px solid #ddd;
                        padding: 6px;
                        text-align: left;
                    }
                    .costing-table th { background-color: #f5f5f5; }
                </style>
                <table class="costing-table">
                    <thead>
                        <tr>
                            <th>Select</th>
                            <th>Furniture</th>
                            <th>ĐVT</th>
                            <th>Rate per Unit</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            records.forEach(r => {
                html += `
                    <tr>
                        <td>
                            <input type="checkbox"
                            data-name="${r.name}"
                            data-furniture="${r.furniture || ""}"
                            data-dvt="${r.dvt || ""}"
                            data-rate="${r.rate_per_unit || 0}">
                        </td>
                        <td>${r.furniture || ""}</td>
                        <td>${r.dvt || ""}</td>
                        <td>${frappe.format(r.rate_per_unit || 0, {fieldtype: "Currency"})}</td>
                    </tr>
                `;
            });

            html += `</tbody></table>`;

            // Dialog hiển thị bảng
            let d = new frappe.ui.Dialog({
                title: __('Select Furniture Costings'),
                fields: [{ fieldtype: 'HTML', fieldname: 'costing_html' }],
                primary_action_label: 'Select',
                primary_action() {
                    const checked = d.$wrapper.find('input[type="checkbox"]:checked');
                    if (checked.length === 0) {
                        frappe.msgprint(__('Please select at least one record'));
                        return;
                    }
                
                    checked.each(function() {
                        const furniture = $(this).data("furniture");
                        const dvt = $(this).data("dvt");
                        const rate = $(this).data("rate");   // 👈 phải dùng "rate" vì HTML attr là data-rate
                    
                        let row = frm.add_child("items");
                        row.furniture = furniture;
                        row.dvt = dvt;
                        row.rate_per_unit = rate;
                    });
                
                    frm.refresh_field("items");
                    d.hide();
                }
                
            });

            d.fields_dict.costing_html.$wrapper.html(html);
            d.show();
        }
    });
}

// --- Recalc helpers ---
function recalc_and_update(frm, cdt, cdn) {
    const row = locals[cdt][cdn] || {};
    const rate_per_unit = parseFloat(row.rate_per_unit) || 0;
    const margin = parseFloat(row.margin) || 0;
    const qty = parseFloat(row.qty) || 0;

    const denom = 1 - (margin / 100.0);
    const rate_bg = denom !== 0 ? (rate_per_unit / denom) : 0;
    frappe.model.set_value(cdt, cdn, "rate_bg", rate_bg);

    const amount = qty * rate_bg;
    frappe.model.set_value(cdt, cdn, "amount", amount);

    update_total_amount(frm);
    update_total_cost(frm);
}

function update_total_amount(frm) {
    let total = 0;
    (frm.doc.items || []).forEach(r => total += parseFloat(r.amount) || 0);
    frm.set_value("total_amount", total);
}
function update_total_cost(frm) {
    let total_cost = 0;
    (frm.doc.items || []).forEach(r => {
        const rate = parseFloat(r.rate_per_unit) || 0;
        const qty = parseFloat(r.qty) || 0;
        total_cost += rate * qty;
    });
    frm.set_value("total_cost", total_cost);
}
