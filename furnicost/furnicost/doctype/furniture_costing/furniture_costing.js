// --- Furniture Costing (parent) ---
frappe.ui.form.on("Furniture Costing", {
    costing_template: function(frm) {
        if (frm.doc.costing_template) {
            frm.clear_table("items");

            frappe.call({
                method: "frappe.client.get",
                args: {
                    doctype: "Costing Template",
                    name: frm.doc.costing_template
                },
                callback: function(r) {
                    if (r.message && r.message.items) {
                        r.message.items.forEach(d => {
                            let row = frm.add_child("items");
                            row.furniture_part = d.furniture_part;
                            row.qty = d.qty;
                        });
                        frm.refresh_field("items");
                        update_group_items(frm);
                    }
                }
            });
        } else {
            frm.clear_table("items");
            frm.refresh_field("items");
            update_group_items(frm);
        }
    },

    refresh(frm) {
        console.log("[FurniCost] furniture_costing.js loaded for", frm.doc.name);
    },

    validate(frm) {
        update_group_items(frm);
    },

    items_add: function(frm, cdt, cdn) {
        console.log("[FurniCost] Row added:", cdn);
        update_group_items(frm);
    },

    items_remove: function(frm) {
        update_group_items(frm);
    },
    dvt: update_kl_bg,
    width: update_kl_bg,
    height: update_kl_bg,
    depth: update_kl_bg
});

// --- Costing Items (child table) ---
frappe.ui.form.on("Costing Items", {
    form_render: function(frm, cdt, cdn) {
        console.log("[FurniCost] Costing Items row rendered:", cdn);
    },

    item_code: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        if (row.item_code) {
            frappe.db.get_value("Item", row.item_code, ["stock_uom", "last_purchase_rate"])
                .then(r => {
                    if (r.message) {
                        frappe.model.set_value(cdt, cdn, "uom", r.message.stock_uom);
                        frappe.model.set_value(cdt, cdn, "stock_uom", r.message.stock_uom);
                        frappe.model.set_value(cdt, cdn, "rate", r.message.last_purchase_rate);
                        frappe.model.set_value(cdt, cdn, "conversion_factor", 1); // mặc định 1
                        row.__last_purchase_rate = r.message.last_purchase_rate; // lưu tạm để tính sau
                    }
                })
                .then(() => {
                    recalc_and_group(frm, cdt, cdn);
                });
        } else {
            recalc_and_group(frm, cdt, cdn);
        }
    },
    
    furniture_part: function(frm, cdt, cdn) {
        let row = locals[cdt][cdn];
        if (!row.furniture_part) return;
    
        // ✅ Reset fields về null trước
        frappe.model.set_value(cdt, cdn, "width", null);
        frappe.model.set_value(cdt, cdn, "height", null);
        frappe.model.set_value(cdt, cdn, "depth", null);
    
        frappe.db.get_doc("Furniture Part", row.furniture_part).then(part => {
            const selected = [];
    
            if (part.is_fix_height) selected.push(["height", frm.doc.height]);
            if (part.is_fix_width) selected.push(["width", frm.doc.width]);
            if (part.is_fix_depth) selected.push(["depth", frm.doc.depth]);
    
            const only_fix_depth = (
                part.is_fix_depth &&
                !part.is_fix_height &&
                !part.is_fix_width
            );
    
            // ✅ Luôn luôn gán default_thickness nếu có
            if (part.default_thickness) {
                frappe.model.set_value(cdt, cdn, "depth", part.default_thickness);
            }
    
            if (only_fix_depth) {
                if (!row.width && frm.doc.depth) {
                    frappe.model.set_value(cdt, cdn, "width", frm.doc.depth);
                }
            } else if (selected.length === 1) {
                const [fname, val] = selected[0];
                if (!row[fname]) {
                    frappe.model.set_value(cdt, cdn, fname, val);
                }
            } else if (selected.length === 2) {
                const vals = selected.map(s => s[1]).sort((a, b) => b - a); // big, small
                if (!row.height) {
                    frappe.model.set_value(cdt, cdn, "height", vals[0]);
                }
                if (!row.width) {
                    frappe.model.set_value(cdt, cdn, "width", vals[1]);
                }
            } else if (selected.length === 3) {
                if (!row.height) {
                    frappe.model.set_value(cdt, cdn, "height", frm.doc.height);
                }
                if (!row.width) {
                    frappe.model.set_value(cdt, cdn, "width", frm.doc.width);
                }
                if (!row.depth) {
                    frappe.model.set_value(cdt, cdn, "depth", frm.doc.depth);
                }
            }
    
            // ✅ Tính lại qty_per_unit và amount
            setTimeout(() => {
                recalc_and_group(frm, cdt, cdn);
            }, 200);
        });
    },
    uom: function(frm, cdt, cdn) {
        handle_uom_conversion(frm, cdt, cdn);
    },
    conversion_factor: function(frm, cdt, cdn) {
        handle_uom_conversion(frm, cdt, cdn);
    },  
    

    width: recalc_and_group,
    height: recalc_and_group,
    depth: recalc_and_group,
    qty_per_unit: recalc_and_group,
    qty: recalc_and_group,
    rate: recalc_and_group
});

// --- Helper functions ---
function recalc_and_group(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    if (!row) return;

    // Tính lại qty_per_unit
    let uom = (row.uom || "").toLowerCase();
    let qty_per_unit = 1;

    if (uom === "m2") {
        qty_per_unit = ((row.width || 0) * (row.height || 0)) / 1_000_000;
    } else if (uom === "md") {
        qty_per_unit = (row.width || 0) / 1000;
    } else if (uom === "m3") {
        qty_per_unit = ((row.width || 0) * (row.height || 0) * (row.depth || 0)) / 1_000_000_000;
    }

    if (qty_per_unit < 0 || isNaN(qty_per_unit)) {
        qty_per_unit = 0;
    }

    // Cập nhật lại qty_per_unit và amount
    frappe.model.set_value(cdt, cdn, "qty_per_unit", qty_per_unit);
    let amount = (row.rate || 0) * qty_per_unit * (row.qty || 0);
    frappe.model.set_value(cdt, cdn, "amount", amount);

    // Sau đó update bảng group_items
    update_group_items(frm);
}
function handle_uom_conversion(frm, cdt, cdn) {
    let row = locals[cdt][cdn];
    const last_rate = row.__last_purchase_rate || row.rate;

    if (row.uom && row.stock_uom && row.uom !== row.stock_uom && row.conversion_factor) {
        const new_rate = (last_rate || 0) * row.conversion_factor;
        frappe.model.set_value(cdt, cdn, "rate", new_rate);
    }

    recalc_and_group(frm, cdt, cdn);
}
function update_kl_bg(frm) {
    const dvt = (frm.doc.dvt || "").toLowerCase();
    const width = frm.doc.width || 0;
    const height = frm.doc.height || 0;
    const depth = frm.doc.depth || 0;

    let kl_bg = 1;

    if (dvt === "m2") {
        kl_bg = (width * height) / 1_000_000;
    } else if (dvt === "md") {
        // Lấy giá trị lớn hơn giữa height và width, chia cho 10^3
        kl_bg = Math.max(width, height) / 1000;
    } else if (dvt === "m3") {
        kl_bg = (width * height * depth) / 1_000_000_000;
    }

    if (kl_bg < 0 || isNaN(kl_bg)) kl_bg = 1;

    frm.set_value("kl_bg", kl_bg);
}


function update_group_items(frm) {
    if (!frm.doc.items) return;

    let grouped = {};

    frm.doc.items.forEach(d => {
        if (!d.item_code) return;

        let key = `${d.item_code}||${d.uom}||${d.rate || 0}`;
        let qty_total = (d.qty_per_unit || 0) * (d.qty || 0);

        if (!grouped[key]) {
            grouped[key] = {
                item_code: d.item_code,
                uom: d.uom,
                rate: d.rate || 0,
                total_qty: qty_total
            };
        } else {
            grouped[key].total_qty += qty_total;
        }
    });

    frm.clear_table("group_items");

    Object.values(grouped).forEach(row => {
        row.amount = row.total_qty * row.rate;
        frm.add_child("group_items", row);
    });

    frm.refresh_field("group_items");
}

