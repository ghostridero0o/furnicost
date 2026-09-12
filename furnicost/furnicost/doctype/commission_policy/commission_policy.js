frappe.ui.form.on("Commission Policy", {
	setup(frm) {
		frm.set_query("commission_tier", "rules", () => ({
			filters: frm.doc.company ? { company: frm.doc.company, enabled: 1 } : { enabled: 1 },
		}));
		frm.set_query("commission_role", "rules", () => ({
			filters: frm.doc.company ? { company: frm.doc.company, enabled: 1 } : { enabled: 1 },
		}));
		frm.set_query("employee_incentive_salary_component", () => ({
			filters: { type: "Earning", disabled: 0 },
		}));
		for (const fieldname of ["employee_incentive_expense_account", "petty_expense_account"]) {
			frm.set_query(fieldname, () => ({
				filters: {
					company: frm.doc.company,
					is_group: 0,
					root_type: "Expense",
				},
			}));
		}
		for (const fieldname of ["employee_incentive_cost_center", "petty_expense_cost_center"]) {
			frm.set_query(fieldname, () => ({
				filters: { company: frm.doc.company, is_group: 0 },
			}));
		}
	},

	company(frm) {
		if (!frm.doc.__islocal || !frm.doc.rules?.length) return;
		frm.clear_table("rules");
		frm.refresh_field("rules");
	},
});
