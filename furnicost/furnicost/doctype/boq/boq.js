if (window.erpnext?.accounts?.taxes) {
	cur_frm.cscript.tax_table = "Sales Taxes and Charges";
	erpnext.accounts.taxes.setup_tax_validations("Sales Taxes and Charges Template");
	erpnext.accounts.taxes.setup_tax_filters("Sales Taxes and Charges");
}

// ==========================
// BOQ (parent)
// ==========================
frappe.ui.form.on("BOQ", {
	setup(frm) {
		frm.set_query("taxes_and_charges", () => ({
			filters: {
				company: frm.doc.company,
			},
		}));
	},
	refresh(frm) {
		recalc_boq_items(frm);
	},
	validate(frm) {
		recalc_boq_items(frm);
	},
	taxes_and_charges(frm) {
		if (frm.doc.taxes_and_charges) {
			frm.call({
				method: "erpnext.controllers.accounts_controller.get_taxes_and_charges",
				args: {
					master_doctype: "Sales Taxes and Charges Template",
					master_name: frm.doc.taxes_and_charges,
				},
				callback: (r) => {
					if (!r.exc) {
						frm.set_value("taxes", r.message || []);
						recalc_boq_totals(frm);
					}
				},
			});
		} else {
			frm.set_value("taxes", []);
			recalc_boq_totals(frm);
		}
	},
	apply_discount_on(frm) {
		recalc_boq_totals(frm);
	},
	additional_discount_percentage(frm) {
		recalc_boq_totals(frm);
	},
	discount_amount(frm) {
		recalc_boq_totals(frm);
	},
	items_add(frm, cdt, cdn) {
		recalc_boq_item(frm, cdt, cdn);
	},
	items_remove(frm) {
		recalc_boq_items(frm);
	},
	items_on_form_rendered(doc, grid_row) {
		if (grid_row && grid_row.doc) {
			recalc_boq_item(cur_frm, grid_row.doc.doctype, grid_row.doc.name);
		}
	},
});

// ==========================
// BOQ Item (child table)
// ==========================
frappe.ui.form.on("BOQ Item", {
	form_render(frm, cdt, cdn) {
		recalc_boq_item(frm, cdt, cdn);
	},
	uom: recalc_boq_item,
	length: recalc_boq_item,
	height: recalc_boq_item,
	depth: recalc_boq_item,
	qty: recalc_boq_item,
	rate: recalc_boq_item,
});

// ==========================
// Sales Taxes and Charges (child table)
// ==========================
frappe.ui.form.on("Sales Taxes and Charges", {
	charge_type(frm) {
		recalc_boq_totals(frm);
	},
	rate(frm) {
		recalc_boq_totals(frm);
	},
	tax_amount(frm) {
		recalc_boq_totals(frm);
	},
	add_deduct_tax(frm) {
		recalc_boq_totals(frm);
	},
});

// ==========================
// Helper: Recalc amounts
// ==========================
function recalc_boq_item(frm, cdt, cdn) {
	const row = locals[cdt][cdn];
	if (!row) return;

	const uom = String(row.uom || "")
		.toLowerCase()
		.replace(/\s+/g, "")
		.replace("²", "2");
	const length = flt(row.length);
	const height = flt(row.height);
	const depth = flt(row.depth);
	const qty = flt(row.qty);
	const rate = flt(row.rate);
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

	recalc_boq_totals(frm);
}

function recalc_boq_items(frm) {
	(frm.doc.items || []).forEach((row) => {
		recalc_boq_item(frm, row.doctype, row.name);
	});
	frm.refresh_field("items");
	recalc_boq_totals(frm);
}

function recalc_boq_totals(frm) {
	if (frappe.flags.boq_recalc_in_progress) {
		return;
	}
	frappe.flags.boq_recalc_in_progress = true;

	const items = frm.doc.items || [];
	const taxes = frm.doc.taxes || [];
	const total_qty = items.reduce((sum, row) => sum + flt(row.qty), 0);
	const total = items.reduce((sum, row) => sum + flt(row.amount), 0);

	frappe.model.set_value(frm.doctype, frm.doc.name, "total_qty", total_qty);
	frappe.model.set_value(frm.doctype, frm.doc.name, "total", total);

	const apply_discount_on = frm.doc.apply_discount_on || "Net Total";
	const discount_percent = flt(frm.doc.additional_discount_percentage);
	let discount_amount = flt(frm.doc.discount_amount);
	let discount_base = total;

	let total_taxes_and_charges = 0;
	let running_total = total;
	let prev_row_amount = 0;

	if (taxes.length) {
		taxes.forEach((tax, idx) => {
			let tax_amount = flt(tax.tax_amount);
			const charge_type = tax.charge_type || "";
			const rate = flt(tax.rate);

			if (charge_type === "On Net Total") {
				tax_amount = (total * rate) / 100;
			} else if (charge_type === "On Previous Row Amount") {
				tax_amount = (prev_row_amount * rate) / 100;
			} else if (charge_type === "On Previous Row Total") {
				tax_amount = (running_total * rate) / 100;
			} else if (charge_type === "On Item Quantity") {
				tax_amount = total_qty * rate;
			}

			if (tax.add_deduct_tax === "Deduct") {
				tax_amount = -Math.abs(tax_amount);
			}

			total_taxes_and_charges += tax_amount;
			running_total = total + total_taxes_and_charges;
			prev_row_amount = tax_amount;

			frappe.model.set_value(tax.doctype, tax.name, "tax_amount", tax_amount);
			frappe.model.set_value(tax.doctype, tax.name, "total", running_total);
		});
	}

	if (apply_discount_on === "Grand Total") {
		discount_base = total + total_taxes_and_charges;
	}

	if (discount_percent) {
		discount_amount = (discount_base * discount_percent) / 100;
		frappe.model.set_value(frm.doctype, frm.doc.name, "discount_amount", discount_amount);
	}

	let grand_total = total + total_taxes_and_charges;
	if (apply_discount_on === "Grand Total") {
		grand_total -= discount_amount;
	} else {
		grand_total = total - discount_amount + total_taxes_and_charges;
	}

	const conversion_rate = flt(frm.doc.conversion_rate) || 1;
	frappe.model.set_value(
		frm.doctype,
		frm.doc.name,
		"base_total_taxes_and_charges",
		total_taxes_and_charges * conversion_rate
	);
	frappe.model.set_value(
		frm.doctype,
		frm.doc.name,
		"total_taxes_and_charges",
		total_taxes_and_charges
	);
	frappe.model.set_value(frm.doctype, frm.doc.name, "grand_total", grand_total);

	frappe.flags.boq_recalc_in_progress = false;
}
