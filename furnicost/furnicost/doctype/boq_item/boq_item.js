const set_boq_item_amounts = (frm, cdt, cdn) => {
	const row = locals[cdt][cdn];
	const uom = (row.uom || "").toLowerCase();
	const length = frappe.utils.flt(row.length);
	const height = frappe.utils.flt(row.height);
	const depth = frappe.utils.flt(row.depth);
	const qty = frappe.utils.flt(row.qty);
	const rate = frappe.utils.flt(row.rate);
	let weight = 0;

	if (uom === "m2") {
		weight = (length * height / 1000000) * qty;
	} else if (uom === "md") {
		weight = (length / 1000) * qty;
	} else if (uom === "m3") {
		weight = (length * height * depth / 1000000000) * qty;
	} else {
		weight = qty;
	}

	frappe.model.set_value(cdt, cdn, "weight_rc", weight);
	frappe.model.set_value(cdt, cdn, "amount", rate * weight);
};

frappe.ui.form.on("BOQ Item", {
	uom(frm, cdt, cdn) {
		set_boq_item_amounts(frm, cdt, cdn);
	},
	length(frm, cdt, cdn) {
		set_boq_item_amounts(frm, cdt, cdn);
	},
	height(frm, cdt, cdn) {
		set_boq_item_amounts(frm, cdt, cdn);
	},
	depth(frm, cdt, cdn) {
		set_boq_item_amounts(frm, cdt, cdn);
	},
	qty(frm, cdt, cdn) {
		set_boq_item_amounts(frm, cdt, cdn);
	},
	rate(frm, cdt, cdn) {
		set_boq_item_amounts(frm, cdt, cdn);
	},
});
