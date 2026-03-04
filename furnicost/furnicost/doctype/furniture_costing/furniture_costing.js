// ==========================
// Furniture Costing (parent)
// ==========================
frappe.ui.form.on("Furniture Costing", {
    costing_template(frm) {
        if (frm.doc.costing_template) {
            frm.clear_table("items");
            frappe.call({
                method: "frappe.client.get",
                args: { doctype: "Costing Template", name: frm.doc.costing_template },
                callback(r) {
                    if (r.message && r.message.items) {
                        r.message.items.forEach(d => {
                            const row = frm.add_child("items");
                            row.furniture_part = d.furniture_part;
                            row.qty = d.qty;
                            row.process_loss = d.process_loss;
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
        (frm.doc.items || []).forEach(d => {
            recalc_and_group(frm, d.doctype, d.name, true);
        });
        update_group_items(frm);
    },

    items_add(frm, cdt, cdn) {
        console.log("[FurniCost] Row added:", cdn);
        update_group_items(frm);
    },

    items_remove(frm) {
        update_group_items(frm);
    },

    rm_cost_as_per(frm) {
        if (frm.doc.rm_cost_as_per !== "Price List") {
            frm.set_value("price_list", null);
        }
        update_all_items_rate(frm);
    },

    price_list(frm) {
        if (frm.doc.rm_cost_as_per === "Price List") {
            update_all_items_rate(frm);
        }
    },

    margin(frm) {
        calculate_rate_bg(frm);
    },
    rate_per_unit(frm) {
        calculate_rate_bg(frm);
    },

    dvt: update_kl_bg,
    width: update_kl_bg,
    height: update_kl_bg,
    depth: update_kl_bg
});


// =============================
// Costing Items (child table)
// =============================
frappe.ui.form.on("Costing Items", {
    form_render(frm, cdt, cdn) {
        console.log("[FurniCost] Costing Items row rendered:", cdn);
    },

    item_code(frm, cdt, cdn) {
        update_item_rate(frm, cdt, cdn);
    },

    furniture_part(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (!row.furniture_part) return;

        // Reset kích thước
        frappe.model.set_value(cdt, cdn, "width", null);
        frappe.model.set_value(cdt, cdn, "height", null);
        frappe.model.set_value(cdt, cdn, "depth", null);

        frappe.db.get_doc("Furniture Part", row.furniture_part).then(part => {
            const selected = [];
            if (part.is_fix_height) selected.push(["height", frm.doc.height]);
            if (part.is_fix_width)  selected.push(["width",  frm.doc.width]);
            if (part.is_fix_depth)  selected.push(["depth",  frm.doc.depth]);

            const only_fix_depth = (part.is_fix_depth && !part.is_fix_height && !part.is_fix_width);

            // Gán default_thickness nếu có
            if (part.default_thickness) {
                frappe.model.set_value(cdt, cdn, "depth", part.default_thickness);
            }

            if (only_fix_depth) {
                if (!row.width && frm.doc.depth) {
                    frappe.model.set_value(cdt, cdn, "width", frm.doc.depth);
                }
            } else if (selected.length === 1) {
                const [fname, val] = selected[0];
                if (!row[fname]) frappe.model.set_value(cdt, cdn, fname, val);
            } else if (selected.length === 2) {
                const vals = selected.map(s => s[1]).sort((a, b) => b - a); // big, small
                if (!row.height) frappe.model.set_value(cdt, cdn, "height", vals[0]);
                if (!row.width)  frappe.model.set_value(cdt, cdn, "width",  vals[1]);
            } else if (selected.length === 3) {
                if (!row.height) frappe.model.set_value(cdt, cdn, "height", frm.doc.height);
                if (!row.width)  frappe.model.set_value(cdt, cdn, "width",  frm.doc.width);
                if (!row.depth)  frappe.model.set_value(cdt, cdn, "depth",  frm.doc.depth);
            }

            setTimeout(() => recalc_and_group(frm, cdt, cdn), 200);
        });
    },

    // Chỉ đổi UOM sau khi đã có item_code (và stock_uom do Doctype fetch)
    uom(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (!row.item_code) return;
        handle_uom_conversion(frm, cdt, cdn);
    },

    conversion_factor(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (!row.item_code) return;
        handle_uom_conversion(frm, cdt, cdn);
    },

    width:         recalc_and_group,
    height:        recalc_and_group,
    depth:         recalc_and_group,
    qty_per_unit:  recalc_and_group,
    process_loss:  recalc_and_group,
    qty:           recalc_and_group,
    rate:          recalc_and_group
});


// =====================
// Helper: Giá BG
// =====================
function calculate_rate_bg(frm) {
    const rate_per_unit = Number(frm.doc.rate_per_unit) || 0;
    const margin        = Number(frm.doc.margin) || 0;
    if (rate_per_unit > 0) {
        const rate_bg = rate_per_unit / (1 - (margin / 100));
        frm.set_value("rate_bg", rate_bg);
    } else {
        frm.set_value("rate_bg", 0);
    }
}


// =====================
// Helper: Recalc & Group
// =====================
function recalc_and_group(frm, cdt, cdn, skip_group) {
    const row = locals[cdt][cdn];
    if (!row) return;

    let qty_per_unit = 1;
    const uom = String(row.uom || "").toLowerCase();
    const process_loss = Number(row.process_loss) || 0;
    const loss_factor = 1 - (process_loss / 100);

    if (uom === "m2") {
        qty_per_unit = ((row.width || 0) * (row.height || 0)) / 1_000_000;
    } else if (uom === "md") {
        qty_per_unit = (row.width || 0) / 1000;
    } else if (uom === "m3") {
        qty_per_unit = ((row.width || 0) * (row.height || 0) * (row.depth || 0)) / 1_000_000_000;
    }

    if (loss_factor <= 0) {
        // Ignore process_loss when >= 100%
        qty_per_unit = qty_per_unit;
    } else {
        qty_per_unit = qty_per_unit / loss_factor;
        if (qty_per_unit < 0 || isNaN(qty_per_unit) || !isFinite(qty_per_unit)) qty_per_unit = 0;
    }

    frappe.model.set_value(cdt, cdn, "qty_per_unit", qty_per_unit);

    const amount = (Number(row.rate) || 0) * qty_per_unit * (Number(row.qty) || 0);
    frappe.model.set_value(cdt, cdn, "amount", amount);

    if (!skip_group) update_group_items(frm);
}


// =====================
// Helper: UOM Conversion
// (Không set stock_uom ở client)
// =====================
function handle_uom_conversion(frm, cdt, cdn) {
    const row = locals[cdt][cdn];
    if (!row) return;

    // Base rate theo stock_uom, lưu khi gọi update_item_rate
    const base = (typeof row.__base_rate_in_stock === "number")
        ? row.__base_rate_in_stock
        : (Number(row.rate) || 0);

    let new_rate = base;

    // Cần đủ uom, stock_uom (do Doctype fetch), conversion_factor
    if (row.item_code && row.uom && row.stock_uom && row.conversion_factor) {
        if (row.uom === row.stock_uom) {
            new_rate = base;
        } else {
            new_rate = base * Number(row.conversion_factor || 1);
        }
    }

    frappe.model.set_value(cdt, cdn, "rate", new_rate);
    recalc_and_group(frm, cdt, cdn);
}


// =====================
// Helper: KL_BG theo DVT
// =====================
function update_kl_bg(frm) {
    const dvt    = String(frm.doc.dvt || "").toLowerCase();
    const width  = Number(frm.doc.width)  || 0;
    const height = Number(frm.doc.height) || 0;
    const depth  = Number(frm.doc.depth)  || 0;

    let kl_bg = 1;

    if (dvt === "m2") {
        kl_bg = (width * height) / 1_000_000;
    } else if (dvt === "md") {
        kl_bg = Math.max(width, height) / 1000;
    } else if (dvt === "m3") {
        kl_bg = (width * height * depth) / 1_000_000_000;
    }

    if (kl_bg < 0 || isNaN(kl_bg)) kl_bg = 1;
    frm.set_value("kl_bg", kl_bg);
}


// =====================
// Helpers: xử lý giá
// =====================
function update_all_items_rate(frm) {
    if (!frm.doc.items) return;
    (frm.doc.items || []).forEach(d => update_item_rate(frm, d.doctype, d.name));
}

function update_item_rate(frm, cdt, cdn) {
    const row = locals[cdt][cdn];
    if (!row || !row.item_code) return;

    const mode = frm.doc.rm_cost_as_per;

    if (mode === "Valuation Rate" || mode === "Last Purchase Rate") {
        const field = (mode === "Valuation Rate") ? "valuation_rate" : "last_purchase_rate";

        frappe.db.get_value("Item", row.item_code, [field, "stock_uom"]).then(r => {
            if (r.message) {
                const base = Number(r.message[field]) || 0;
                row.__base_rate_in_stock = base;

                frappe.model.set_value(cdt, cdn, "rate", base);
                frappe.model.set_value(cdt, cdn, "stock_uom", r.message.stock_uom);

                if (!row.conversion_factor || Number(row.conversion_factor) === 0) {
                    frappe.model.set_value(cdt, cdn, "conversion_factor", 1);
                }
            }
        }).then(() => {
            handle_uom_conversion(frm, cdt, cdn);
        });

    } else if (mode === "Price List" && frm.doc.price_list) {
        frappe.db.get_value("Item Price", {
            item_code: row.item_code,
            price_list: frm.doc.price_list
        }, ["price_list_rate", "uom"]).then(r => {
            if (r.message) {
                const base = Number(r.message.price_list_rate) || 0;
                row.__base_rate_in_stock = base;

                frappe.model.set_value(cdt, cdn, "rate", base);

                if (r.message.uom) {
                    // cập nhật cả stock_uom và uom
                    frappe.model.set_value(cdt, cdn, "stock_uom", r.message.uom);
                    frappe.model.set_value(cdt, cdn, "uom", r.message.uom);
                } else {
                    // fallback: nếu Item Price không có UOM, lấy UOM chuẩn từ Item
                    frappe.db.get_value("Item", row.item_code, "stock_uom").then(r2 => {
                        if (r2.message) {
                            frappe.model.set_value(cdt, cdn, "stock_uom", r2.message.stock_uom);
                            // chỉ set uom nếu hiện tại đang trống
                            if (!row.uom) {
                                frappe.model.set_value(cdt, cdn, "uom", r2.message.stock_uom);
                            }
                        }
                    });
                }
                
            }
        }).then(() => {
            handle_uom_conversion(frm, cdt, cdn);
        });

    } else {
        handle_uom_conversion(frm, cdt, cdn);
    }
}



// =====================
// Grouping bảng group_items
// =====================
function update_group_items(frm) {
    if (!frm.doc.items) return;

    const grouped = {};

    (frm.doc.items || []).forEach(d => {
        if (!d.item_code) return;

        const key = `${d.item_code}||${d.uom}||${d.rate || 0}||${d.depth || 0}`;
        const qty_total = (Number(d.qty_per_unit) || 0) * (Number(d.qty) || 0);

        if (!grouped[key]) {
            grouped[key] = {
                item_code: d.item_code,
                uom: d.uom,
                rate: Number(d.rate) || 0,
                depth: d.depth || 0,
                total_qty: qty_total
            };
        } else {
            grouped[key].total_qty += qty_total;
        }
        
    });

    frm.clear_table("group_items");

    const total_amount = Number(frm.doc.total_amount) || 0;
    const margin = Number(frm.doc.margin) || 0;
    const denom = 1 - (margin / 100);

    Object.values(grouped).forEach(row => {
        row.amount = row.total_qty * row.rate;
        row.cost_ratio = total_amount > 0 ? (row.amount / total_amount) * 100 : 0;
        row.price_ratio = (total_amount > 0 && denom > 0)
            ? ((row.amount / total_amount) * 100) * denom
            : 0;
        frm.add_child("group_items", row);
    });

    frm.refresh_field("group_items");
}
