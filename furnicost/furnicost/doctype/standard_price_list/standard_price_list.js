frappe.ui.form.on("Standard Price List", {
	refresh(frm) {
		const grid = frm.fields_dict.items.grid;
		$(grid.wrapper).find(".spl-excel-actions").remove();
		const actions = $('<div class="spl-excel-actions" style="margin-top:10px"></div>').appendTo(grid.wrapper);
		$('<button type="button" class="btn btn-default btn-sm" style="margin-right:8px"></button>')
			.text(__("Download Excel")).on("click", function () { downloadSplExcel(frm, $(this)); }).appendTo(actions);
		if (frm.doc.docstatus !== 0 || !frm.perm?.some((permission) => permission.write)) return;
		const input = $('<input type="file" accept=".xlsx" style="display:none">').appendTo(actions);
		const button = $('<button type="button" class="btn btn-default btn-sm"></button>')
			.text(__("Upload Excel")).on("click", () => input.val("").trigger("click")).appendTo(actions);
		input.on("change", async () => {
			const file = input[0].files[0];
			if (!file) return;
			if (!file.name.toLowerCase().endsWith(".xlsx") || file.size > 5 * 1024 * 1024) {
				frappe.msgprint(__("Please select an .xlsx file smaller than 5 MB."));
				return;
			}
			button.prop("disabled", true);
			try {
				const content = await new Promise((resolve, reject) => {
					const reader = new FileReader();
					reader.onload = () => resolve(reader.result.split(",")[1]);
					reader.onerror = reject;
					reader.readAsDataURL(file);
				});
				const response = await frappe.call({
					method: "furnicost.furnicost.doctype.standard_price_list.standard_price_list.preview_excel",
					args: { content, filename: file.name, name: frm.is_new() ? null : frm.doc.name },
					freeze: true, freeze_message: __("Reading Excel..."),
				});
				if (response.message) showSplExcelPreview(frm, response.message);
			} catch (error) {
				console.error("Standard Price List Excel upload failed", error);
				frappe.msgprint(__("Unable to read this Excel file. Please check the file and try again."));
			} finally {
				button.prop("disabled", false);
			}
		});
	},
});

async function downloadSplExcel(frm, button) {
	button.prop("disabled", true);
	try {
		const fields = ["item_code", "item_name", "category", "carcass_material", "door_material", "back_material", "description", "uom", "rate"];
		const items = (frm.doc.items || []).map((row) => Object.fromEntries(fields.map((field) => [field, row[field] ?? ""])));
		const response = await frappe.call({
			method: "furnicost.furnicost.doctype.standard_price_list.standard_price_list.download_excel",
			args: { items: JSON.stringify(items), name: frm.is_new() ? null : frm.doc.name },
			freeze: true, freeze_message: __("Preparing Excel..."),
		});
		if (!response.message) return;
		const bytes = Uint8Array.from(atob(response.message), (character) => character.charCodeAt(0));
		const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = `${(frm.doc.title || frm.doc.name || "Standard Price List").replace(/[\\/:*?"<>|]/g, "_")}.xlsx`;
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	} catch (error) {
		console.error("Standard Price List Excel download failed", error);
		frappe.msgprint(__("Unable to download Excel. Please try again."));
	} finally {
		button.prop("disabled", false);
	}
}

function showSplExcelPreview(frm, result) {
	const dialog = new frappe.ui.Dialog({
		title: __("Preview Excel import"), size: "extra-large",
		fields: [
			{ fieldname: "mode", fieldtype: "Select", label: __("Import mode"),
				options: "Add new items only\nUpdate matching codes and add new items\nReplace all items", default: "Add new items only", reqd: 1 },
			{ fieldname: "preview", fieldtype: "HTML" },
		],
		primary_action_label: __("Apply to table"),
		primary_action() {
			if (!result.items.length) return;
			const mode = dialog.get_value("mode");
			const apply = () => {
				const plan = planSplExcelImport(frm.doc.items || [], result.items, mode);
				if (mode === "Replace all items") frm.clear_table("items");
				plan.updates.forEach(({ index, values }) => Object.assign(frm.doc.items[index], values));
				plan.additions.forEach((values) => Object.assign(frm.add_child("items"), values));
				if (plan.updates.length || plan.additions.length) {
					frm.dirty();
					frm.refresh_field("items");
				}
				dialog.hide();
				frappe.msgprint(__("Added {0}, updated {1}, skipped existing codes {2}. Save the document to keep these changes.", [plan.additions.length, plan.updates.length, plan.skipped]));
			};
			if (mode === "Replace all items" && frm.doc.items?.length) {
				frappe.confirm(__("Replace all current rows with the valid rows from this file?"), apply);
			} else apply();
		},
	});
	const wrapper = dialog.fields_dict.preview.$wrapper;
	$("<p></p>").text(__("Sheet: {0}. Valid rows: {1}. Skipped rows: {2}.", [result.sheet, result.items.length, result.warnings.length])).appendTo(wrapper);
	if (result.warnings.length) {
		const details = $("<details></details>").appendTo(wrapper);
		$("<summary></summary>").text(__("Review skipped rows")).appendTo(details);
		$("<pre></pre>").css({ "max-height": "180px", overflow: "auto", "white-space": "pre-wrap" }).text(result.warnings.join("\n")).appendTo(details);
	}
	const table = $('<table class="table table-bordered"></table>').appendTo($('<div class="table-responsive"></div>').css("max-height", "350px").appendTo(wrapper));
	const columns = [["item_code", "Item Code"], ["item_name", "Item Name"], ["category", "Hạng mục"], ["uom", "Đơn vị"], ["rate", "Giá bán"]];
	const header = $("<tr></tr>").appendTo($("<thead></thead>").appendTo(table));
	columns.forEach(([, label]) => $("<th></th>").text(__(label)).appendTo(header));
	const body = $("<tbody></tbody>").appendTo(table);
	result.items.slice(0, 20).forEach((item) => {
		const row = $("<tr></tr>").appendTo(body);
		columns.forEach(([field]) => $("<td></td>").text(field === "rate" ? new Intl.NumberFormat("vi-VN").format(item.rate) : item[field]).appendTo(row));
	});
	$("<p class='text-muted'></p>").text(__("Preview shows the first 20 valid rows. All valid rows will be applied. Changes are not saved automatically.")).appendTo(wrapper);
	dialog.show();
	dialog.get_primary_btn().prop("disabled", !result.items.length);
}

function planSplExcelImport(existing, incoming, mode) {
	const updates = [], additions = [];
	let skipped = 0;
	const index = new Map(existing.map((row, i) => [String(row.item_code || "").trim().toLocaleLowerCase(), i]));
	incoming.forEach((values) => {
		const key = values.item_code.trim().toLocaleLowerCase();
		if (mode === "Replace all items" || !index.has(key)) additions.push(values);
		else if (mode === "Update matching codes and add new items") updates.push({ index: index.get(key), values });
		else skipped++;
	});
	return { updates, additions, skipped };
}
