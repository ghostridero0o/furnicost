// Parent: Furniture Summary
frappe.ui.form.on("Furniture Summary", {
    refresh(frm) {
        update_total_amount(frm); // đảm bảo đồng bộ ngay khi mở form
        update_total_cost(frm);
    },
    items_add(frm, cdt, cdn) {
        recalc_and_update(frm, cdt, cdn); // tính cho dòng mới
    },
    items_remove(frm) {
        update_total_amount(frm); // xóa dòng thì cộng tổng lại
        update_total_cost(frm);
    }
});

// Child: Furniture Summary Items  <-- đổi thành "Furniture Summary Item" nếu DocType của bạn không có 's'
frappe.ui.form.on("Furniture Summary Items", {
    form_render(frm, cdt, cdn) {
        recalc_and_update(frm, cdt, cdn); // render xong tính luôn để hiển thị đúng
    },
    rate_per_unit(frm, cdt, cdn) {
        recalc_and_update(frm, cdt, cdn);
    },
    margin(frm, cdt, cdn) {
        recalc_and_update(frm, cdt, cdn);
    },
    qty(frm, cdt, cdn) {
        recalc_and_update(frm, cdt, cdn);
    },
    furniture_part(frm, cdt, cdn) {
        recalc_and_update(frm, cdt, cdn); // nếu part đổi mà rate_per_unit thay đổi theo logic khác
    }
});

// ---- Helpers ----
function recalc_and_update(frm, cdt, cdn) {
    const row = locals[cdt][cdn] || {};

    const rate_per_unit = parseFloat(row.rate_per_unit) || 0;
    const margin = parseFloat(row.margin) || 0;   // %
    const qty = parseFloat(row.qty) || 0;

    // tránh chia 0 khi margin = 100%
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

