frappe.query_reports["Project Commission Summary"] = {
	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			default: frappe.defaults.get_user_default("Company"),
			reqd: 1,
			on_change() {
				frappe.query_report.set_filter_value({
					project: [],
					policy: null,
					commission_tier: null,
				});
			},
		},
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
			default: `${frappe.datetime.get_today().slice(0, 4)}-01-01`,
			reqd: 1,
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
			reqd: 1,
		},
		{
			fieldname: "project",
			label: __("Project"),
			fieldtype: "MultiSelectList",
			options: "Project",
			get_data(txt) {
				return frappe.db.get_link_options("Project", txt, {
					company: frappe.query_report.get_filter_value("company"),
				});
			},
		},
		{
			fieldname: "customer",
			label: __("Customer"),
			fieldtype: "Link",
			options: "Customer",
		},
		{
			fieldname: "policy",
			label: __("Commission Policy"),
			fieldtype: "Link",
			options: "Commission Policy",
			get_query() {
				return {filters: {company: frappe.query_report.get_filter_value("company")}};
			},
		},
		{
			fieldname: "commission_tier",
			label: __("Commission Tier"),
			fieldtype: "Link",
			options: "Commission Tier",
			get_query() {
				return {filters: {company: frappe.query_report.get_filter_value("company")}};
			},
		},
		{
			fieldname: "status",
			label: __("Status"),
			fieldtype: "Select",
			options: "\nDraft\nApproved\nPartly Paid\nPaid\nCancelled",
		},
		{
			fieldname: "contract_value_source",
			label: __("Contract Value Source"),
			fieldtype: "Select",
			options: "\nSales Order\nSales Invoice",
		},
		{
			fieldname: "recipient_type",
			label: __("Recipient Type"),
			fieldtype: "Select",
			options: "\nEmployee\nSupplier\nCustomer\nSales Partner",
		},
		{
			fieldname: "recipient",
			label: __("Recipient"),
			fieldtype: "Dynamic Link",
			options: "recipient_type",
			depends_on: "eval:doc.recipient_type",
		},
		{
			fieldname: "include_cancelled",
			label: __("Include Cancelled"),
			fieldtype: "Check",
			default: 0,
		},
		{
			fieldname: "summary_view",
			label: __("Summary View"),
			fieldtype: "Check",
			default: 1,
			on_change() {
				frappe.query_report.refresh();
			},
		},
	],

	formatter(value, row, column, data, default_formatter) {
		if (
			column.fieldname === "recipient_name" && data?.recipient && data?.recipient_type
		) {
			const label = frappe.utils.escape_html(value || data.recipient);
			const href = frappe.utils.get_form_link(data.recipient_type, data.recipient);
			return `<a href="${href}">${label}</a>`;
		}

		value = default_formatter(value, row, column, data);
		if (column.fieldname === "outstanding_amount" && flt(data?.outstanding_amount) < 0) {
			return `<span class="text-success">${value}</span>`;
		}
		return value;
	},
};
