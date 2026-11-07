# Copyright (c) 2025, ghostridêro0o and contributors
# For license information, please see license.txt

# import frappe
import frappe
from frappe.model.document import Document
from frappe.utils import flt


class FurnitureSummary(Document):
    def validate(self):
        seen = set()
        for row in self.items:
            if not row.source_boq:
                if not row.furniture:
                    frappe.throw(f"Dòng {row.idx}: vui lòng chọn Furniture")
                continue
            key = (row.source_boq, row.source_boq_item)
            if not row.source_boq_item or key in seen:
                frappe.throw(f"Dòng {row.idx}: dòng BOQ nguồn thiếu hoặc bị trùng")
            seen.add(key)
            row.amount = flt(row.rate_bg) * flt(row.qty)
            if row.furniture:
                costing = frappe.get_doc("Furniture Costing", row.furniture)
                costing.check_permission("read")
                if normalize_uom(row.dvt) != normalize_uom(costing.dvt):
                    frappe.throw(f"Dòng {row.idx}: đơn vị BOQ ({row.dvt}) khác Furniture ({costing.dvt})")
                row.rate_per_unit = flt(costing.rate_per_unit)
                row.margin = (1 - flt(row.rate_per_unit) / flt(row.rate_bg)) * 100 if flt(row.rate_bg) else 0
                row.cost_status = "Đã có giá vốn" if flt(row.rate_bg) else "Giá báo bằng 0 — không tính % lãi"
            else:
                row.rate_per_unit = 0
                row.margin = 0
                row.cost_status = "Chưa có giá vốn"
        self.total_amount = sum(flt(row.amount) for row in self.items)
        self.total_cost = sum(flt(row.rate_per_unit) * flt(row.qty) for row in self.items)


def normalize_uom(value):
    return "".join((value or "").lower().replace("²", "2").replace("³", "3").split())


@frappe.whitelist()
def get_boq_items(boq, project=None, customer=None):
    if not frappe.has_permission("Furniture Summary", "write"):
        frappe.throw("Không có quyền sửa Furniture Summary", frappe.PermissionError)
    doc = frappe.get_doc("BOQ", boq)
    doc.check_permission("read")
    if doc.docstatus == 2:
        frappe.throw("Không thể lấy BOQ đã hủy")
    if project and doc.project != project:
        frappe.throw("BOQ không cùng Project")
    if customer and doc.customer != customer:
        frappe.throw("BOQ không cùng Customer")
    return [dict(source_boq=doc.name, source_boq_item=row.name,
                 boq_item_name=row.item_name, furniture=row.costing_item or "",
                 dvt=row.uom, rate_bg=row.rate, qty=row.weight_rc,
                 amount=row.amount) for row in doc.items]


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


