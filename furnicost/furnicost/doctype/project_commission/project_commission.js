frappe.ui.form.on("Project Commission", {
	setup(frm) {
		frm.set_query("project", () => ({
			filters: frm.doc.company ? { company: frm.doc.company } : {},
		}));
		frm.set_query("sales_order", "sales_orders", () => ({
			filters: {
				docstatus: 1,
				...(frm.doc.company ? { company: frm.doc.company } : {}),
				...(frm.doc.project ? { project: frm.doc.project } : {}),
			},
		}));
		frm.set_query("sales_invoice", "sales_invoices", () => ({
			filters: {
				docstatus: 1,
				...(frm.doc.company ? { company: frm.doc.company } : {}),
				...(frm.doc.project ? { project: frm.doc.project } : {}),
			},
		}));
		frm.set_query("policy", () => ({
			filters: frm.doc.company ? { company: frm.doc.company, enabled: 1 } : { enabled: 1 },
		}));
		frm.set_query("commission_tier", () => ({
			filters: frm.doc.company ? { company: frm.doc.company, enabled: 1 } : { enabled: 1 },
		}));
		frm.set_query("commission_role", "participants", () => ({
			filters: frm.doc.company ? { company: frm.doc.company, enabled: 1 } : { enabled: 1 },
		}));
	},

	refresh(frm) {
		register_recipient_link_titles(frm);
		if (frm.doc.docstatus !== 1) return;
		frm.add_custom_button(
			__("Employee Incentive"),
			() => open_creation_dialog(frm, "Employee Incentive"),
			__("Create")
		);
		frm.add_custom_button(
			__("Expense"),
			() => open_creation_dialog(frm, "Petty Expense"),
			__("Create")
		);
	},

	company(frm) {
		if (!frm.doc.company) return;
		if (frm.doc.policy) frm.set_value("policy", null);
		if (frm.doc.commission_tier) frm.set_value("commission_tier", null);
		frm.clear_table("sales_orders");
		frm.clear_table("sales_invoices");
		frm.clear_table("participants");
		frm.refresh_field("sales_orders");
		frm.refresh_field("sales_invoices");
		frm.refresh_field("participants");
	},

	project(frm) {
		if (!frm.doc.project) {
			frm.clear_table("sales_orders");
			frm.clear_table("sales_invoices");
			frm.refresh_field("sales_orders");
			frm.refresh_field("sales_invoices");
			return;
		}
		frm.call("set_project_context").then(() => frm.refresh_fields());
	},

	contract_value_source(frm) {
		if (!frm.doc.project) {
			frm.set_value("contract_value", 0);
			return;
		}
		frm.call("set_contract_value_source_context").then(() => frm.refresh_fields());
	},

	policy(frm) {
		if (!frm.doc.policy) {
			frm.clear_table("participants");
			frm.refresh_field("participants");
			return;
		}
		if (frm.doc.commission_tier) {
			frm.call("load_policy_participants").then(() => frm.refresh_fields());
			return;
		}
		frm.clear_table("participants");
		frm.refresh_field("participants");
		frappe.db.get_value("Commission Policy", frm.doc.policy, "commission_basis").then((r) => {
			if (!r.message) return;
			frm.set_value("commission_basis", r.message.commission_basis).then(() => {
				const has_contract_documents = frm.doc.contract_value_source === "Sales Invoice"
					? frm.doc.sales_invoices?.length
					: frm.doc.sales_orders?.length;
				if (has_contract_documents) {
					frm.call("set_contract_documents_context").then(() => frm.refresh_fields());
				}
			});
		});
	},

	commission_tier(frm) {
		if (!frm.doc.policy || !frm.doc.commission_tier) return;
		frm.call("load_policy_participants").then(() => frm.refresh_fields());
	},

	commission_base_amount(frm) {
		for (const row of frm.doc.participants || []) {
			calculate_commission_row(frm, row.doctype, row.name);
		}
	},

	contract_value(frm) {
		if (!frm.doc.contract_value || !frm.doc.company) return;
		frm.call("match_commission_tier").then((r) => {
			frm.refresh_fields();
			const result = r.message || {};
			if (result.reason === "no_default_policy") {
				frappe.show_alert({
					message: __("No default Commission Policy was found for this Company and Posting Date."),
					indicator: "orange",
				});
			} else if (result.reason === "no_matching_tier") {
				frappe.show_alert({
					message: __("No Commission Tier matches the current Contract Value and Project Type."),
					indicator: "orange",
				});
			} else if (result.reason === "tier_not_in_policy") {
				frappe.show_alert({
					message: __("The matched Commission Tier has no enabled rules in the selected Policy."),
					indicator: "orange",
				});
			}
		});
	},
});

frappe.ui.form.on("Project Commission Sales Order", {
	sales_order(frm) {
		update_contract_document_totals(frm);
	},

	sales_orders_remove(frm) {
		update_contract_document_totals(frm);
	},
});

frappe.ui.form.on("Project Commission Sales Invoice", {
	sales_invoice(frm) {
		update_contract_document_totals(frm);
	},

	sales_invoices_remove(frm) {
		update_contract_document_totals(frm);
	},
});

function update_contract_document_totals(frm) {
	frm.call("set_contract_documents_context").then(() => frm.refresh_fields());
}

frappe.ui.form.on("Project Commission Participant", {
	commission_role(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row.commission_role) return;
		frappe.db.get_value("Commission Role", row.commission_role, "default_party_type").then((r) => {
			if (r.message && !row.recipient_type) {
				frappe.model.set_value(cdt, cdn, "recipient_type", r.message.default_party_type);
			}
		});
	},

	applied_rate(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		frappe.model.set_value(cdt, cdn, "rate_overridden", flt(row.applied_rate) !== flt(row.policy_rate));
		calculate_commission_row(frm, cdt, cdn);
	},

	paid_amount(frm, cdt, cdn) {
		calculate_commission_row(frm, cdt, cdn);
	},

	recipient(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		set_recipient_name(frm, row).then(() => calculate_commission_row(frm, cdt, cdn));
	},

	recipient_type(frm) {
		update_commission_totals(frm);
	},

	participants_add(frm) {
		update_commission_totals(frm);
	},

	participants_remove(frm) {
		update_commission_totals(frm);
	},
});

function calculate_commission_row(frm, cdt, cdn) {
	const row = locals[cdt][cdn];
	let amount = 0;
	if (row.recipient) {
		amount = flt(frm.doc.commission_base_amount) * flt(row.applied_rate) / 100;
		if (flt(row.minimum_commission_amount)) amount = Math.max(amount, flt(row.minimum_commission_amount));
		if (flt(row.maximum_commission_amount)) amount = Math.min(amount, flt(row.maximum_commission_amount));
	}
	Promise.all([
		frappe.model.set_value(cdt, cdn, "commission_amount", amount),
		frappe.model.set_value(cdt, cdn, "outstanding_amount", amount - flt(row.paid_amount)),
	]).then(() => update_commission_totals(frm));
}

function set_recipient_name(frm, row) {
	if (!row.recipient_type || !row.recipient) {
		return frappe.model.set_value(row.doctype, row.name, "recipient_name", null);
	}
	const name_fields = {
		Employee: "employee_name",
		Supplier: "supplier_name",
		Customer: "customer_name",
		"Sales Partner": "partner_name",
	};
	const name_field = name_fields[row.recipient_type];
	if (!name_field) return Promise.resolve();
	return frappe.db.get_value(row.recipient_type, row.recipient, name_field).then((r) => {
		const recipient_name = r.message?.[name_field] || row.recipient;
		frappe.utils.add_link_title(row.recipient_type, row.recipient, recipient_name);
		return frappe.model.set_value(row.doctype, row.name, "recipient_name", recipient_name)
			.then(() => frm.refresh_field("participants"));
	});
}

function register_recipient_link_titles(frm) {
	for (const row of frm.doc.participants || []) {
		if (row.recipient_type && row.recipient && row.recipient_name) {
			frappe.utils.add_link_title(row.recipient_type, row.recipient, row.recipient_name);
		}
	}
	frm.refresh_field("participants");
}

function update_commission_totals(frm) {
	const rows = frm.doc.participants || [];
	const total_commission = rows.reduce((total, row) => total + flt(row.commission_amount), 0);
	const total_paid = rows.reduce((total, row) => total + flt(row.paid_amount), 0);
	const total_incentive = rows
		.filter((row) => row.recipient_type === "Employee")
		.reduce((total, row) => total + flt(row.commission_amount), 0);
	frm.set_value("total_commission", total_commission);
	frm.set_value("total_paid", total_paid);
	frm.set_value("total_incentive", total_incentive);
	frm.set_value("total_outstanding", total_commission - total_paid);
}

function open_creation_dialog(frm, target_doctype) {
	const is_employee_incentive = target_doctype === "Employee Incentive";
	const allowed_types = is_employee_incentive
		? ["Employee"]
		: ["Customer", "Supplier", "Sales Partner"];
	const candidates = (frm.doc.participants || [])
		.filter((row) => allowed_types.includes(row.recipient_type) && flt(row.outstanding_amount) > 0)
		.map((row) => ({
			participant_name: row.name,
			commission_role: row.commission_role,
			recipient_type: row.recipient_type,
			recipient: row.recipient,
			recipient_name: row.recipient_name,
			commission_amount: row.commission_amount,
			paid_amount: row.paid_amount,
			outstanding_amount: row.outstanding_amount,
			creation_amount: row.outstanding_amount,
		}));

	if (!candidates.length) {
		frappe.msgprint(__("There are no eligible recipients with an outstanding commission amount."));
		return;
	}

	const dialog = new frappe.ui.Dialog({
		title: is_employee_incentive
			? __("Create Employee Incentive")
			: __("Create Petty Expense"),
		fields: [
			{
				fieldname: "participants",
				fieldtype: "Table",
				label: __("Recipients"),
				cannot_add_rows: true,
				cannot_delete_rows: true,
				in_place_edit: true,
				data: candidates,
				fields: [
					{ fieldname: "participant_name", fieldtype: "Data", hidden: 1 },
					{ fieldname: "commission_role", fieldtype: "Link", options: "Commission Role", label: __("Role"), in_list_view: 1, read_only: 1 },
					{ fieldname: "recipient_type", fieldtype: "Data", label: __("Recipient Type"), in_list_view: 1, read_only: 1 },
					{ fieldname: "recipient", fieldtype: "Data", label: __("Recipient"), in_list_view: 1, read_only: 1 },
					{ fieldname: "recipient_name", fieldtype: "Data", label: __("Recipient Name"), in_list_view: 1, read_only: 1 },
					{ fieldname: "outstanding_amount", fieldtype: "Currency", label: __("Outstanding Amount"), in_list_view: 1, read_only: 1 },
					{ fieldname: "creation_amount", fieldtype: "Currency", label: __("Amount This Time"), in_list_view: 1, reqd: 1 },
				],
			},
		],
		primary_action_label: __("Create"),
		primary_action() {
			const selected = dialog.fields_dict.participants.grid
				.get_selected_children()
				.map((row) => ({
					participant_name: row.participant_name,
					amount: flt(row.creation_amount),
				}));
			if (!selected.length) {
				frappe.msgprint(__("Select at least one recipient."));
				return;
			}
			if (selected.some((row) => row.amount <= 0)) {
				frappe.msgprint(__("Amount This Time must be greater than zero."));
				return;
			}

			frappe.call({
				method: is_employee_incentive
					? "furnicost.furnicost.doctype.project_commission.project_commission.create_employee_incentives"
					: "furnicost.furnicost.doctype.project_commission.project_commission.create_petty_expenses",
				args: {
					project_commission: frm.doc.name,
					participant_allocations: selected,
				},
				freeze: true,
				freeze_message: __("Creating documents..."),
				callback(r) {
					const result = r.message || {};
					const links = (result.created || []).map((name) =>
						`<a href="${frappe.utils.get_form_link(result.doctype, name)}">${name}</a>`
					);
					dialog.hide();
					frappe.msgprint({
						title: __("Created Successfully"),
						indicator: "green",
						message: __("Created {0}: {1}", [result.doctype, links.join(", ")]),
					});
					frm.reload_doc();
				},
			});
		},
	});
	dialog.show();
}
