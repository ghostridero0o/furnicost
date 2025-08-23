# Copyright (c) 2025, ghostridêro0o and contributors
# For license information, please see license.txt

# import frappe
import frappe
from frappe.model.document import Document
from frappe.utils import flt


class FurnitureSummary(Document):
	pass
@frappe.whitelist()
def get_group_items_from_furniture(furniture_name):
    costing = frappe.get_doc("Furniture Costing", furniture_name)
    items = []

    kl_bg = flt(costing.kl_bg) or 1  # tránh chia 0

    for row in costing.group_items:
        scaled_qty = (flt(row.total_qty) or 0) / kl_bg
        amount = scaled_qty * (flt(row.rate) or 0)

        items.append({
            "item_code": row.item_code,
            "uom": row.uom,
            "rate": row.rate,
            "total_qty": scaled_qty,
            "amount": amount
        })

    return items
