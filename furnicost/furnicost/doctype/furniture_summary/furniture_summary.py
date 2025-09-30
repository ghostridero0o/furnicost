# Copyright (c) 2025, ghostridêro0o and contributors
# For license information, please see license.txt

# import frappe
import frappe
from frappe.model.document import Document
from frappe.utils import flt


class FurnitureSummary(Document):
     
	pass

@frappe.whitelist()
def get_group_items_from_furniture(furniture_name, summary_qty=1):
    costing = frappe.get_doc("Furniture Costing", furniture_name)
    kl_bg = flt(costing.kl_bg) or 1

    items = []
    for row in costing.group_items:
        scaled_qty = (flt(row.total_qty) or 0) / kl_bg * flt(summary_qty)
        items.append({
            "item_code": row.item_code,
            "uom": row.uom,
            "depth": row.depth,
            "rate": row.rate,
            "total_qty": scaled_qty,   # dùng scaled_qty
            "amount": scaled_qty * (flt(row.rate) or 0)
        })
    return items

