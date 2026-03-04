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
		frm.set_query("customer_address", erpnext.queries.address_query);
		frm.set_query("company_address", erpnext.queries.company_address_query);
	},
	refresh(frm) {
		recalc_boq_items(frm);
		if (!frm.is_new()) {
			frm.add_custom_button(__("Create Sales Order"), () => {
				frappe.model.open_mapped_doc({
					method: "furnicost.furnicost.doctype.boq.boq.make_sales_order",
					frm: frm,
				});
			});
			frm.add_custom_button(__("Get Items From"), () => {
				showSourceDialog(frm);
			});
		}
	},
	customer(frm) {
		if (frm.doc.customer) {
			erpnext.utils.get_party_details(frm);
		} else {
			frm.set_value("customer_address", "");
		}
	},
	company(frm) {
		if (!frm.doc.company) {
			frm.set_value("company_address", "");
			return;
		}

		frappe.call({
			method: "erpnext.setup.doctype.company.company.get_default_company_address",
			args: {
				name: frm.doc.company,
				existing_address: frm.doc.company_address || "",
			},
			debounce: 2000,
			callback: (r) => {
				frm.set_value("company_address", (r && r.message) || "");
			},
		});
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
// GET ITEMS FROM FURNITURE COSTING
// ==========================
function showSourceDialog(frm) {
	frappe.prompt(
		[
			{
				fieldname: "source_type",
				label: __("Get From"),
				fieldtype: "Select",
				options: ["Project", "Customer"],
				reqd: 1,
			},
		],
		(values) => {
			const fieldname = values.source_type.toLowerCase();
			const value = frm.doc[fieldname];

			if (!value) {
				frappe.msgprint(__("Please set {0} before continuing", [values.source_type]));
				return;
			}

			fetchAndShowCostings(frm, fieldname, value);
		},
		__("Get Items From"),
		__("Continue")
	);
}

function fetchAndShowCostings(frm, fieldname, value) {
	const filters = { [fieldname]: value };

	frappe.call({
		method: "frappe.client.get_list",
		args: {
			doctype: "Furniture Costing",
			filters,
			fields: ["name", "furniture", "dvt", "width", "height", "depth", "rate_bg"],
			limit_page_length: 100,
		},
		callback(r) {
			const records = r.message || [];
			if (!records.length) {
				frappe.msgprint(__("No Furniture Costing found"));
				return;
			}

			showCostingSelectionDialog(frm, records);
		},
	});
}

function showCostingSelectionDialog(frm, records) {
	const html = buildCostingTableHTML(records);

	const dialog = new frappe.ui.Dialog({
		title: __("Select Furniture Costings"),
		fields: [
			{
				fieldtype: "HTML",
				fieldname: "costing_html",
			},
		],
		primary_action_label: __("Select"),
		primary_action() {
			const selected = getSelectedCostings(dialog);
			if (!selected.length) {
				frappe.msgprint(__("Please select at least one record"));
				return;
			}

			addSelectedItemsToForm(frm, selected);
			dialog.hide();
		},
	});

	dialog.fields_dict.costing_html.$wrapper.html(html);
	dialog.show();
}

function buildCostingTableHTML(records) {
	const rows = records
		.map(
			(r) => `
        <tr>
            <td>
                <input type="checkbox"
                    data-furniture="${r.furniture || ""}"
                    data-dvt="${r.dvt || ""}"
                    data-width="${r.width || 0}"
                    data-height="${r.height || 0}"
                    data-depth="${r.depth || 0}"
                    data-rate="${r.rate_bg || 0}">
            </td>
            <td>${r.furniture || ""}</td>
            <td>${r.dvt || ""}</td>
            <td>${r.width || 0}</td>
            <td>${r.height || 0}</td>
            <td>${r.depth || 0}</td>
            <td>${frappe.format(r.rate_bg || 0, { fieldtype: "Currency" })}</td>
        </tr>
    `
		)
		.join("");

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
                    <th>Width</th>
                    <th>Height</th>
                    <th>Depth</th>
                    <th>Rate BG</th>
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

	dialog.$wrapper.find('input[type="checkbox"]:checked').each(function () {
		const $checkbox = $(this);
		selected.push({
			furniture: $checkbox.data("furniture"),
			dvt: $checkbox.data("dvt"),
			width: $checkbox.data("width"),
			height: $checkbox.data("height"),
			depth: $checkbox.data("depth"),
			rate_bg: $checkbox.data("rate"),
		});
	});

	return selected;
}

function addSelectedItemsToForm(frm, items) {
	items.forEach((item) => {
		const row = frm.add_child("items");
		Object.assign(row, {
			item_name: item.furniture || "",
			uom: item.dvt || "",
			length: item.width || 0,
			height: item.height || 0,
			depth: item.depth || 0,
			rate: item.rate_bg || 0,
		});
		recalc_boq_item(frm, row.doctype, row.name);
	});

	frm.refresh_field("items");
}

// ==========================
// BOQ Item (child table)
// ==========================
frappe.ui.form.on("BOQ Item", {
	form_render(frm, cdt, cdn) {
		recalc_boq_item(frm, cdt, cdn);
	},
	item_name(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row || !row.item_name) return;

		frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype: "Furniture Costing",
				filters: { furniture: row.item_name },
				fields: ["dvt", "width", "height", "depth", "rate_bg"],
				limit_page_length: 1,
				order_by: "modified desc",
			},
			callback(r) {
				const rec = (r.message && r.message[0]) || null;
				if (!rec) return;

				frappe.model.set_value(cdt, cdn, "uom", rec.dvt || "");
				frappe.model.set_value(cdt, cdn, "length", rec.width || 0);
				frappe.model.set_value(cdt, cdn, "height", rec.height || 0);
				frappe.model.set_value(cdt, cdn, "depth", rec.depth || 0);
				frappe.model.set_value(cdt, cdn, "rate", rec.rate_bg || 0);

				recalc_boq_item(frm, cdt, cdn);
			},
		});
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
