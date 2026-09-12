frappe.listview_settings["Project Commission"] = {
	add_fields: ["status", "docstatus"],
	has_indicator_for_draft: true,
	get_indicator(doc) {
		let status = doc.status;
		if (doc.docstatus === 0) status = "Draft";
		if (doc.docstatus === 2) status = "Cancelled";

		const colors = {
			Draft: "gray",
			Approved: "blue",
			"Partly Paid": "orange",
			Paid: "green",
			Cancelled: "red",
		};

		return [__(status), colors[status] || "gray", `status,=,${status}`];
	},
};
