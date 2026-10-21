if (window.erpnext?.accounts?.taxes) {
	cur_frm.cscript.tax_table = "Sales Taxes and Charges";
	erpnext.accounts.taxes.setup_tax_validations("Sales Taxes and Charges Template");
	erpnext.accounts.taxes.setup_tax_filters("Sales Taxes and Charges");
}

frappe.require("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");

const BOQ_EXCEL_COLUMNS = [
	{ label: "Item Code", fieldname: "item_code" },
	{ label: "Item Name", fieldname: "item_name" },
	{ label: "Material Description", fieldname: "material_description" },
	{ label: "Origin", fieldname: "origin" },
	{ label: "Length", fieldname: "length" },
	{ label: "Height", fieldname: "height" },
	{ label: "Depth", fieldname: "depth" },
	{ label: "Qty", fieldname: "qty" },
	{ label: "UOM", fieldname: "uom" },
	{ label: "Weight RC", fieldname: "weight_rc" },
	{ label: "Rate", fieldname: "rate" },
	{ label: "Amount", fieldname: "amount" },
	{ label: "Image", fieldname: "image" },
	{ label: "Notes", fieldname: "notes" },
];

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
		setupBoqItemsExcelActions(frm);
		if (!frm.is_new()) {
			frm.add_custom_button(__("Create Sales Order"), () => {
				frappe.model.open_mapped_doc({
					method: "furnicost.furnicost.doctype.boq.boq.make_sales_order",
					frm: frm,
				});
			});
			frm.add_custom_button(__("Costing"), () => {
				showSourceDialog(frm);
			}, __("Get Items From"));
			frm.add_custom_button(__("BOQ"), () => {
				showBoqItemsDialog(frm);
			}, __("Get Items From"));
		}
		if (frm.doc.docstatus === 0 && frm.perm?.some((permission) => permission.write)) {
			frm.add_custom_button(__("Standard Price List"), () => {
				showStandardPriceListDialog(frm);
			}, __("Get Items From"));
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

// Select child rows from a Standard Price List.
function showStandardPriceListDialog(frm) {
	frappe.prompt([
		{ fieldname: "price_list", fieldtype: "Link", options: "Standard Price List",
			label: __("Standard Price List"), reqd: 1, get_query: () => ({ filters: { disabled: 0 } }) },
	], (values) => {
		frappe.call({
			method: "frappe.client.get",
			args: { doctype: "Standard Price List", name: values.price_list },
			callback(r) {
				const doc = r.message;
				if (!doc || doc.disabled) {
					frappe.msgprint(__("This Standard Price List is unavailable."));
					return;
				}
				showPriceListItemsDialog(frm, { title: doc.title || doc.name, items: doc.items || [] });
			},
		});
	}, __("Select Standard Price List"), __("Continue"));
}

function showPriceListItemsDialog(frm, price_list) {
	const selected = new Map();
	const page_size = 50;
	let start = 0;
	let records = [];
	const all_records = price_list.items;
	let column_filters = {};
	let sort = { field: "item_code", direction: 1 };
	const filter_fields = [
		["item_name", "Item Name"],
		["item_code", "Item Code"],
		["category", "Hạng mục"],
		["carcass_material", "Vật liệu thùng"],
		["door_material", "Vật liệu cánh"],
	];
	const dialog = new frappe.ui.Dialog({
		title: __("Standard Price List: {0}", [price_list.title]),
		size: "extra-large",
		fields: [
			{ fieldtype: "HTML", fieldname: "results" },
		],
		primary_action_label: __("Get Items"),
		primary_action() {
			if (!selected.size) {
				frappe.msgprint(__("Please select at least one record"));
				return;
			}
			appendPriceListItems(frm, [...selected.values()]);
			dialog.hide();
		},
	});
	const wrapper = dialog.fields_dict.results.$wrapper;
	wrapper.css("position", "relative");
	const columns = [...filter_fields, ["description", "Mô tả"], ["rate", "Giá bán"]];
	function render() {
		const filtered = getStandardPriceView(all_records, column_filters, sort);
		start = Math.min(start, Math.max(0, Math.ceil(filtered.length / page_size) - 1) * page_size);
		records = filtered.slice(start, start + page_size);
		wrapper.empty();
		const toolbar = $('<div class="mb-2"></div>').appendTo(wrapper);
		$("<span></span>").text(__("{0} / {1} items · Selected: {2}", [filtered.length, all_records.length, selected.size])).appendTo(toolbar);
		$('<button type="button" class="btn btn-default btn-xs ml-2"></button>')
			.text(__("Clear all filters")).on("click", () => { column_filters = {}; start = 0; render(); }).appendTo(toolbar);
		$("<div class='text-muted small mb-2'></div>").text(__("Use the arrow in each column header to filter or sort.")).appendTo(wrapper);
		const table = $('<table class="table table-bordered table-hover"></table>');
		const header = $("<tr></tr>").appendTo($("<thead></thead>").appendTo(table));
		$("<th></th>").appendTo(header).append(
			$('<input type="checkbox">').attr("aria-label", __("Select this page"))
				.prop("checked", records.length > 0 && records.every((row) => selected.has(row.name)))
				.on("change", function () {
					records.forEach((row) => this.checked ? selected.set(row.name, row) : selected.delete(row.name));
					render();
				})
		);
		columns.forEach(([field, label]) => {
			const th = $("<th></th>").css({ "min-width": field === "rate" ? "130px" : "150px", background: "var(--subtle-fg, #f5f7fa)", position: "sticky", top: 0, "z-index": 1 }).appendTo(header);
			const heading = $('<div style="display:flex;align-items:center;justify-content:space-between;gap:8px"></div>').appendTo(th);
			$("<span></span>").text(__(label) + (sort.field === field ? (sort.direction === 1 ? " ↑" : " ↓") : "")).appendTo(heading);
			$('<button type="button" class="btn btn-xs"></button>')
				.addClass(column_filters[field] ? "btn-primary" : "btn-default")
				.text("▾").attr("aria-label", __("Filter {0}", [__(label)]))
				.on("click", function () { openFilter(field, label, $(this)); }).appendTo(heading);
		});
		const body = $("<tbody></tbody>").appendTo(table);
		records.forEach((row) => {
			const tr = $("<tr></tr>").appendTo(body);
			const checkbox = $('<input type="checkbox">')
				.attr("aria-label", row.item_code).prop("checked", selected.has(row.name));
			$("<td></td>").append(checkbox).appendTo(tr);
			checkbox.on("change", () => {
				checkbox.prop("checked") ? selected.set(row.name, row) : selected.delete(row.name);
				render();
			});
			tr.on("click", (event) => {
				if (event.target !== checkbox[0]) checkbox.prop("checked", !checkbox.prop("checked")).trigger("change");
			});
			columns.forEach(([fieldname]) => {
				const value = fieldname === "rate" ? formatStandardPriceRate(row.rate) : row[fieldname];
				$("<td></td>").text(value == null ? "" : value)
					.css({ "white-space": fieldname === "rate" ? "nowrap" : "pre-wrap", "text-align": fieldname === "rate" ? "right" : "left" })
					.appendTo(tr);
			});
		});
		wrapper.append($('<div class="table-responsive"></div>').css("max-height", "55vh").append(table));
		if (!records.length) $("<p></p>").text(__("No items found")).appendTo(wrapper);
		$('<button type="button" class="btn btn-default btn-sm"></button>').text(__("Previous"))
			.prop("disabled", start === 0).on("click", () => { start -= page_size; render(); }).appendTo(wrapper);
		$('<button type="button" class="btn btn-default btn-sm"></button>').text(__("Next"))
			.prop("disabled", start + page_size >= filtered.length).on("click", () => { start += page_size; render(); }).appendTo(wrapper);
	}
	function openFilter(field, label, button) {
		wrapper.find(".spl-filter-panel").remove();
		const values = [...new Set(getStandardPriceView(all_records, column_filters, sort, field)
			.map((row) => standardPriceFilterValue(row, field)))];
		values.sort((a, b) => field === "rate" ? Number(a) - Number(b) : a.localeCompare(b));
		const draft = new Set(column_filters[field] || values);
		const panel = $('<div class="spl-filter-panel"></div>').css({
			position: "absolute", "z-index": 10, width: "320px", "max-width": "100%",
			left: Math.max(0, Math.min(button.offset().left - wrapper.offset().left, wrapper.width() - 320)),
			top: button.offset().top - wrapper.offset().top + button.outerHeight(),
			background: "var(--fg-color, white)", border: "1px solid var(--border-color, #ddd)",
			"box-shadow": "0 4px 16px #0002", padding: "12px", "border-radius": "6px",
		}).attr("role", "dialog").attr("aria-label", __("Filter {0}", [__(label)])).appendTo(wrapper);
		$("<style></style>").text(`
			.spl-filter-panel input.spl-filter-choice {
				appearance: none !important;
				-webkit-appearance: none !important;
				flex: 0 0 16px;
				width: 16px !important;
				height: 16px !important;
				min-width: 16px;
				margin: 3px 0 0;
				border: 1px solid var(--text-muted, #777) !important;
				border-radius: 50% !important;
				background: var(--fg-color, white) !important;
				box-shadow: none !important;
				cursor: pointer;
			}
			.spl-filter-panel input.spl-filter-choice:checked {
				background: radial-gradient(circle, var(--text-color, #222) 0 4px, var(--fg-color, white) 4.5px) !important;
				border-color: var(--text-color, #222) !important;
			}
			.spl-filter-panel input.spl-filter-choice:focus-visible {
				outline: 2px solid var(--primary, #2490ef);
				outline-offset: 2px;
			}
		`).appendTo(panel);
		$("<strong></strong>").text(__(label)).appendTo(panel);
		const action = (text, callback) => $('<button type="button" class="btn btn-default btn-xs m-1"></button>').text(__(text)).on("click", callback).appendTo(panel);
		action("×", () => panel.remove()).attr("aria-label", __("Close"));
		$("<div></div>").appendTo(panel);
		action(field === "rate" ? "Smallest to largest" : "Sort A to Z", () => { sort = { field, direction: 1 }; start = 0; render(); });
		action(field === "rate" ? "Largest to smallest" : "Sort Z to A", () => { sort = { field, direction: -1 }; start = 0; render(); });
		const search = $('<input type="search" class="form-control input-sm my-2">').attr("placeholder", __("Search values")).attr("aria-label", __("Search values")).appendTo(panel);
		const list = $("<div></div>").css({ "max-height": "220px", overflow: "auto" }).appendTo(panel);
		let visible_values = values;
		function drawValues() {
			const query = search.val().toLocaleLowerCase();
			visible_values = values.filter((value) => (field === "rate" ? formatStandardPriceRate(value) + " " + value : value).toLocaleLowerCase().includes(query));
			list.empty();
			visible_values.forEach((value) => {
				const line = $('<label style="display:flex;gap:8px;align-items:flex-start;font-weight:normal"></label>').appendTo(list);
				$('<input type="checkbox" class="spl-filter-choice">').prop("checked", draft.has(value)).on("change", function () {
					this.checked ? draft.add(value) : draft.delete(value);
				}).appendTo(line);
				$("<span></span>").text(value === "" ? __("(Blanks)") : field === "rate" ? formatStandardPriceRate(value) : value).appendTo(line);
			});
			if (!visible_values.length) $("<p class='text-muted'></p>").text(__("No matching values")).appendTo(list);
		}
		search.on("input", drawValues);
		action("Select visible", () => { visible_values.forEach((value) => draft.add(value)); drawValues(); });
		action("Deselect all", () => { draft.clear(); drawValues(); });
		$("<hr>").appendTo(panel);
		action("Apply", () => {
			// Keep an explicit value set even when every currently available value is checked.
			column_filters[field] = search.val() ? visible_values.filter((value) => draft.has(value)) : [...draft];
			start = 0; render();
		}).addClass("btn-primary");
		action("Clear column filter", () => { delete column_filters[field]; start = 0; render(); });
		panel.on("keydown", (event) => { if (event.key === "Escape") { event.stopPropagation(); panel.remove(); button.trigger("focus"); } });
		drawValues();
		search.trigger("focus");
	}
	dialog.show();
	render();
}

function standardPriceFilterValue(row, field) {
	return String(row[field] == null ? "" : row[field]);
}

function getStandardPriceView(rows, filters, sort, exclude_field) {
	return rows.filter((row) => Object.entries(filters).every(([field, values]) =>
		field === exclude_field || values.includes(standardPriceFilterValue(row, field))
	)).sort((a, b) => {
		const order = sort.field === "rate" ? Number(a.rate || 0) - Number(b.rate || 0)
			: standardPriceFilterValue(a, sort.field).localeCompare(standardPriceFilterValue(b, sort.field));
		return order * sort.direction || String(a.item_code).localeCompare(String(b.item_code));
	});
}

function formatStandardPriceRate(value) {
	return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function appendPriceListItems(frm, items) {
	items.forEach((item) => {
		Object.assign(frm.add_child("items"), {
			item_code: item.item_code || "",
			item_name: item.category,
			material_description: item.description || "",
			rate: item.rate || 0,
			uom: item.uom || "",
			qty: 1,
		});
	});
	frm.dirty();
	recalc_boq_items(frm);
}

function setupBoqItemsExcelActions(frm) {
	const grid_field = frm.fields_dict.items;
	const grid = grid_field?.grid;

	if (!grid || grid.boq_excel_actions_ready) {
		return;
	}

	grid.boq_excel_actions_ready = true;

	const $actions = $('<div class="boq-items-excel-actions" style="margin-top: 10px; display: flex; gap: 8px; align-items: center;"></div>');
	const $download_btn = $(`<button class="btn btn-sm btn-primary">${__("Download Excel")}</button>`);
	const $upload_btn = $(`<button class="btn btn-sm btn-default">${__("Upload Excel")}</button>`);
	const $file_input = $('<input type="file" accept=".xlsx,.xls" style="display:none;">');

	$download_btn.on("click", () => downloadBoqItemsExcel(frm));
	$upload_btn.on("click", () => {
		if (!window.XLSX) {
			frappe.msgprint(__("Excel library is still loading. Please try again in a moment."));
			return;
		}
		$file_input.val("");
		$file_input.trigger("click");
	});
	$file_input.on("change", (event) => handleBoqItemsExcelUpload(frm, event));

	$actions.append($download_btn, $upload_btn, $file_input);
	$(grid.wrapper).append($actions);
}

function downloadBoqItemsExcel(frm) {
	if (!window.XLSX) {
		frappe.msgprint(__("Excel library is still loading. Please try again in a moment."));
		return;
	}

	const rows = [BOQ_EXCEL_COLUMNS.map((column) => column.label)];
	(frm.doc.items || []).forEach((item) => {
		rows.push(
			BOQ_EXCEL_COLUMNS.map((column) => {
				const value = item[column.fieldname];
				return value == null ? "" : value;
			})
		);
	});

	const workbook = XLSX.utils.book_new();
	const worksheet = XLSX.utils.aoa_to_sheet(rows);
	XLSX.utils.book_append_sheet(workbook, worksheet, "BOQ Items");
	XLSX.writeFile(workbook, `${frm.doc.name || "boq"}_boq_items.xlsx`);
}

function handleBoqItemsExcelUpload(frm, event) {
	const file = event.target.files && event.target.files[0];
	if (!file) {
		return;
	}

	if (!window.XLSX) {
		frappe.msgprint(__("Excel library is still loading. Please try again in a moment."));
		return;
	}

	const reader = new FileReader();
	reader.onload = (load_event) => {
		try {
			const workbook = XLSX.read(load_event.target.result, { type: "array" });
			const sheet_name = workbook.SheetNames[0];
			const sheet = workbook.Sheets[sheet_name];
			const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
			const imported_items = parseBoqItemsFromExcel(rows);

			if (!imported_items.length) {
				frappe.msgprint(__("No valid BOQ Items found in the selected Excel file."));
				return;
			}

			const replace_items = () => {
				frm.clear_table("items");
				imported_items.forEach((item) => {
					const child = frm.add_child("items");
					Object.assign(child, item);
				});
				frm.refresh_field("items");
				recalc_boq_items(frm);
				frappe.show_alert({
					message: __("Imported {0} BOQ Items", [imported_items.length]),
					indicator: "green",
				});
			};

			if ((frm.doc.items || []).length) {
				frappe.confirm(
					__("Upload will replace the current BOQ Items. Continue?"),
					replace_items
				);
			} else {
				replace_items();
			}
		} catch (error) {
			console.error("Failed to import BOQ Items from Excel:", error);
			frappe.msgprint(__("Unable to read the Excel file. Please check the format and try again."));
		}
	};
	reader.readAsArrayBuffer(file);
}

function parseBoqItemsFromExcel(rows) {
	if (!rows.length) {
		return [];
	}

	const [header_row, ...data_rows] = rows;
	const header_map = {};

	header_row.forEach((header, index) => {
		header_map[normalizeBoqExcelHeader(header)] = index;
	});

	return data_rows
		.map((row) => buildBoqItemFromExcelRow(row, header_map))
		.filter((row) => row && hasBoqItemData(row));
}

function buildBoqItemFromExcelRow(row, header_map) {
	const item = {};

	BOQ_EXCEL_COLUMNS.forEach((column) => {
		const index = header_map[normalizeBoqExcelHeader(column.label)];
		if (index == null) {
			return;
		}
		item[column.fieldname] = row[index];
	});

	return {
		item_code: cstr(item.item_code || "").trim(),
		item_name: cstr(item.item_name || "").trim(),
		material_description: cstr(item.material_description || "").trim(),
		origin: cstr(item.origin || "").trim(),
		length: flt(item.length),
		height: flt(item.height),
		depth: flt(item.depth),
		qty: flt(item.qty),
		uom: cstr(item.uom || "").trim(),
		rate: flt(item.rate),
		image: cstr(item.image || "").trim(),
		notes: cstr(item.notes || "").trim(),
	};
}

function hasBoqItemData(row) {
	return Boolean(
		row.item_name ||
		row.material_description ||
		row.origin ||
		row.length ||
		row.height ||
		row.depth ||
		row.qty ||
		row.uom ||
		row.rate ||
		row.image ||
		row.notes
	);
}

function normalizeBoqExcelHeader(value) {
	return cstr(value || "")
		trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "");
}

// ==========================
// GET ITEMS FROM FURNITURE COSTING
// ==========================
function showSourceDialog(frm) {
	frappe.prompt(
		[
			{
				fieldname: "source_type",
				label: __("Get From Furniture Costing"),
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
			costing_item: item.furniture || "",
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
// GET ITEMS FROM BOQ
// ==========================
function showBoqItemsDialog(frm) {
	const dialog = new frappe.ui.Dialog({
		title: __("Get Items From BOQ"),
		fields: [
			{
				fieldname: "customer",
				label: __("Customer"),
				fieldtype: "Link",
				options: "Customer",
			},
			{
				fieldname: "project",
				label: __("Project"),
				fieldtype: "Link",
				options: "Project",
			},
			{
				fieldname: "this_boq",
				label: __("This BOQ"),
				fieldtype: "Check",
			},
			{
				fieldtype: "Column Break",
			},
			{
				fieldname: "material_description",
				label: __("Material Description"),
				fieldtype: "Data",
			},
			{
				fieldname: "item_name",
				label: __("Item Name"),
				fieldtype: "Data",
			},
			{
				fieldtype: "Section Break",
			},
			{
				fieldname: "boq_items_html",
				fieldtype: "HTML",
			},
		],
	});

	dialog.set_secondary_action(() => {
		applyBoqItemsFilter(dialog, frm);
	});
	dialog.set_secondary_action_label(__("Apply Filter"));

	dialog.set_primary_action(__("Get Items"), () => {
		appendSelectedBoqItems(dialog, frm);
	});

	dialog.show();
}

function applyBoqItemsFilter(dialog, frm) {
	const values = dialog.get_values();
	if (!values) {
		return;
	}
	dialog._boq_request_id = (dialog._boq_request_id || 0) + 1;
	const request_id = dialog._boq_request_id;
	renderBoqItemsLoading(dialog);
	frappe.call({
		method: "furnicost.furnicost.doctype.boq.boq.get_boq_items",
		args: {
			customer: values.customer || null,
			project: values.project || null,
			item_name: values.item_name || null,
			material_description: values.material_description || null,
			this_boq: values.this_boq ? 1 : 0,
			boq_name: frm.doc.name,
		},
		callback: (r) => {
			if (request_id !== dialog._boq_request_id) {
				return;
			}
			const items = (r && r.message) || [];
			renderBoqItems(dialog, items);
		},
	});
}

function appendSelectedBoqItems(dialog, frm) {
	const rows = getSelectedBoqItems(dialog);

	if (!rows.length) {
		frappe.msgprint(__("Please select at least one BOQ Item."));
		return;
	}

	rows.forEach((row) => {
		const child = frm.add_child("items");
		child.item_name = row.item_name || "";
		child.item_code = row.item_code || "";
		child.material_description = row.material_description || "";
		child.origin = row.origin || "";
		child.length = row.length || 0;
		child.height = row.height || 0;
		child.depth = row.depth || 0;
		child.qty = row.qty || 0;
		child.uom = row.uom || "";
		child.weight_rc = row.weight_rc || 0;
		child.rate = row.rate || 0;
		child.amount = row.amount || 0;
		child.image = row.image || "";
		child.notes = row.notes || "";
		child.costing_item = row.costing_item || "";
	});

	frm.refresh_field("items");
	recalc_boq_items(frm);
	dialog.hide();
}

function renderBoqItems(dialog, items) {
	dialog.boq_items = items;
	const html = buildBoqItemsTableHTML(items);
	dialog.fields_dict.boq_items_html.$wrapper.html(html);
}

function renderBoqItemsLoading(dialog) {
	dialog.boq_items = [];
	dialog.fields_dict.boq_items_html.$wrapper.html(
		`<div class="text-muted">Loading...</div>`
	);
}

function buildBoqItemsTableHTML(items) {
	const rows = items
		.map(
			(row, index) => `
        <tr>
            <td>
                <input type="checkbox"
                    data-idx="${index}"
                    data-item_name="${row.item_name || ""}"
                    data-material_description="${row.material_description || ""}"
                    data-origin="${row.origin || ""}"
                    data-length="${row.length || 0}"
                    data-height="${row.height || 0}"
                    data-depth="${row.depth || 0}"
                    data-qty="${row.qty || 0}"
                    data-uom="${row.uom || ""}"
                    data-weight_rc="${row.weight_rc || 0}"
                    data-rate="${row.rate || 0}"
                    data-amount="${row.amount || 0}"
                    data-image="${row.image || ""}"
                    data-notes="${row.notes || ""}"
                    data-costing_item="${row.costing_item || ""}">
            </td>
            <td>${row.item_name || ""}</td>
            <td>${row.material_description || ""}</td>
            <td>${row.qty || 0}</td>
            <td>${row.uom || ""}</td>
            <td>${row.rate || 0}</td>
            <td>${row.amount || 0}</td>
        </tr>
    `
		)
		.join("");

	return `
        <style>
            .boq-items-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 13px;
            }
            .boq-items-table th,
            .boq-items-table td {
                border: 1px solid #e5e7eb;
                padding: 6px 8px;
                text-align: left;
                vertical-align: top;
            }
            .boq-items-table th {
                background-color: #f5f5f5;
                font-weight: 600;
            }
            .boq-items-table tbody tr:hover {
                background-color: #f9f9f9;
            }
        </style>
        <table class="boq-items-table">
            <thead>
                <tr>
                    <th style="width: 60px;">Select</th>
                    <th>Item Name</th>
                    <th>Material Description</th>
                    <th>Qty</th>
                    <th>UOM</th>
                    <th>Rate</th>
                    <th>Amount</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
    `;
}

function getSelectedBoqItems(dialog) {
	const selected = [];

	dialog.$wrapper.find('input[type="checkbox"]:checked').each(function () {
		const $checkbox = $(this);
		selected.push({
			item_code: dialog.boq_items?.[$checkbox.data("idx")]?.item_code || "",
			item_name: $checkbox.data("item_name"),
			material_description: $checkbox.data("material_description"),
			origin: $checkbox.data("origin"),
			length: flt($checkbox.data("length")),
			height: flt($checkbox.data("height")),
			depth: flt($checkbox.data("depth")),
			qty: flt($checkbox.data("qty")),
			uom: $checkbox.data("uom"),
			weight_rc: flt($checkbox.data("weight_rc")),
			rate: flt($checkbox.data("rate")),
			amount: flt($checkbox.data("amount")),
			image: $checkbox.data("image"),
			notes: $checkbox.data("notes"),
			costing_item: $checkbox.data("costing_item"),
		});
	});

	return selected;
}

// ==========================
// BOQ Item (child table)
// ==========================
frappe.ui.form.on("BOQ Item", {
	item_code(frm) {
		updateBoqItemCodeVisibility(frm);
	},
	items_remove(frm) {
		recalc_boq_items(frm);
	},
	form_render(frm, cdt, cdn) {
		recalc_boq_item(frm, cdt, cdn);
	},
	costing_item(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row || !row.costing_item) return;

		frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype: "Furniture Costing",
				filters: { name: row.costing_item },
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
	if (frm.doc.docstatus !== 0) return;
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

	frappe.model.set_value(cdt, cdn, "weight_rc", flt(weight, precision("weight_rc", row)));
	frappe.model.set_value(cdt, cdn, "amount", flt(rate * weight, precision("amount", row)));

	recalc_boq_totals(frm);
}

function updateBoqItemCodeVisibility(frm) {
	const grid = frm.fields_dict?.items?.grid;
	if (!grid) return;
	const visible = (frm.doc.items || []).some((row) => String(row.item_code || "").trim());
	if (grid._boq_item_code_visible !== visible) {
		grid._boq_item_code_visible = visible;
		grid.toggle_display("item_code", visible);
	}
}

function recalc_boq_items(frm) {
	updateBoqItemCodeVisibility(frm);
	if (frm.doc.docstatus !== 0) return;
	(frm.doc.items || []).forEach((row) => {
		recalc_boq_item(frm, row.doctype, row.name);
	});
	frm.refresh_field("items");
	recalc_boq_totals(frm);
}

function recalc_boq_totals(frm) {
	if (frm.doc.docstatus !== 0 || frappe.flags.boq_recalc_in_progress) {
		return;
	}
	frappe.flags.boq_recalc_in_progress = true;

	const items = frm.doc.items || [];
	const taxes = frm.doc.taxes || [];
	const total_qty = flt(items.reduce((sum, row) => sum + flt(row.qty), 0), precision("total_qty", frm.doc));
	const total = flt(items.reduce((sum, row) => sum + flt(row.amount), 0), precision("total", frm.doc));

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

			tax_amount = flt(tax_amount, precision("tax_amount", tax));
			total_taxes_and_charges = flt(total_taxes_and_charges + tax_amount, precision("total_taxes_and_charges", frm.doc));
			running_total = flt(total + total_taxes_and_charges, precision("total", tax));
			prev_row_amount = tax_amount;

			frappe.model.set_value(tax.doctype, tax.name, "tax_amount", tax_amount);
			frappe.model.set_value(tax.doctype, tax.name, "total", running_total);
		});
	}

	if (apply_discount_on === "Grand Total") {
		discount_base = total + total_taxes_and_charges;
	}

	if (discount_percent) {
		discount_amount = flt((discount_base * discount_percent) / 100, precision("discount_amount", frm.doc));
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
		flt(total_taxes_and_charges * conversion_rate, precision("base_total_taxes_and_charges", frm.doc))
	);
	frappe.model.set_value(
		frm.doctype,
		frm.doc.name,
		"total_taxes_and_charges",
		total_taxes_and_charges
	);
	frappe.model.set_value(frm.doctype, frm.doc.name, "grand_total", flt(grand_total, precision("grand_total", frm.doc)));

	frappe.flags.boq_recalc_in_progress = false;
}
