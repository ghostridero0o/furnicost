// Source snapshots persist on the row, including when it is saved and reopened.
function restoreBoqSalesOrderRates(frm) {
	let changed = false;
	(frm.doc.items || []).forEach((row) => {
		if (!row.custom_boq_source) return;
		if (row.custom_boq_uom && row.uom !== row.custom_boq_uom) {
			row.uom = row.custom_boq_uom;
			changed = true;
			if (row.item_code) {
				const itemCode = row.item_code;
				const uom = row.uom;
				frappe.call({
					method: "erpnext.stock.get_item_details.get_conversion_factor",
					args: { item_code: itemCode, uom },
					callback(r) {
						if (row.item_code !== itemCode || row.uom !== uom || !r.message) return;
						row.conversion_factor = r.message.conversion_factor;
						row.stock_qty = flt(row.qty) * flt(row.conversion_factor);
						frm.refresh_field("items");
						frm.cscript.calculate_taxes_and_totals();
					},
				});
			}
		}
		const rate = flt(row.custom_boq_rate);
		const values = {
			rate,
			price_list_rate: rate * (flt(frm.doc.conversion_rate) || 1) / (flt(frm.doc.plc_conversion_rate) || 1),
			discount_percentage: 0, discount_amount: 0, margin_type: "", margin_rate_or_amount: 0,
			rate_with_margin: rate,
		};
		Object.entries(values).forEach(([field, value]) => {
			if (row[field] !== value) { row[field] = value; changed = true; }
		});
	});
	if (changed) {
		frm.refresh_field("items");
		frm.cscript.calculate_taxes_and_totals();
	}
}

frappe.ui.form.on("Sales Order", {
	refresh(frm) { if (frm.doc.docstatus === 0) restoreBoqSalesOrderRates(frm); },
	validate: restoreBoqSalesOrderRates,
});
frappe.ui.form.on("Sales Order Item", {
	item_code(frm) {
		// Also cover the legacy async item-details request, after its pricing response.
		frappe.after_ajax(() => restoreBoqSalesOrderRates(frm));
	},
	rate: restoreBoqSalesOrderRates,
	price_list_rate: restoreBoqSalesOrderRates,
	discount_percentage: restoreBoqSalesOrderRates,
	discount_amount: restoreBoqSalesOrderRates,
	margin_rate_or_amount: restoreBoqSalesOrderRates,
});
