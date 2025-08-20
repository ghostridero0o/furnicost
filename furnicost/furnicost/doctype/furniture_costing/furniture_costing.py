from frappe.model.document import Document
import frappe

class FurnitureCosting(Document):
    def validate(self):
        # Tính qty_per_unit + amount cho từng item
        self.update_qty_per_unit_and_amount()

        # Áp dụng dimension logic từ Furniture Part
        for d in self.items:
            if not d.furniture_part:
                continue
            part = frappe.get_doc("Furniture Part", d.furniture_part)
            self.apply_dimension_logic(d, part)

        # Tính tổng amount
        self.calculate_total_amount()

        # Tổng hợp group_items
        self.make_group_items()

    def update_qty_per_unit_and_amount(self):
        """Tính qty_per_unit, rate (nếu có conversion), và amount"""
        for d in self.items:
            # 👉 Đồng bộ rate nếu uom khác stock_uom
            if d.uom and d.stock_uom and d.uom != d.stock_uom:
                if d.conversion_factor and d.conversion_factor > 0:
                    item = frappe.get_value("Item", d.item_code, "last_purchase_rate")
                    if item:
                        d.rate = item * d.conversion_factor

            uom = (d.uom or "").lower()
            if uom == "m2":
                d.qty_per_unit = (d.width or 0) * (d.height or 0) / 1_000_000
            elif uom == "md":
                d.qty_per_unit = (d.width or 0) / 1000
            elif uom == "m3":
                d.qty_per_unit = (
                    (d.width or 0) * (d.height or 0) * (d.depth or 0) / 1_000_000_000
                )
            else:
                d.qty_per_unit = 1

            if d.qty_per_unit < 0:
                d.qty_per_unit = 0

            d.amount = (d.rate or 0) * d.qty_per_unit * (d.qty or 0)

    def calculate_total_amount(self):
        """Tính tổng amount từ bảng items"""
        self.total_amount = sum((d.amount or 0) for d in self.items)

    def apply_dimension_logic(self, d, part):
        dims = [
            ("is_fix_height", "height", self.height),
            ("is_fix_width", "width", self.width),
            ("is_fix_depth", "depth", self.depth),
        ]

        selected = [(fname, val) for flag, fname, val in dims if getattr(part, flag, 0)]

        # ✅ Luôn gán default_thickness nếu có
        if getattr(part, "default_thickness", None):
            d.depth = part.default_thickness

        # ✅ Nếu chỉ tick is_fix_depth
        if len(selected) == 1 and selected[0][0] == "depth":
            if not d.width:
                d.width = self.depth
            return

        if len(selected) == 1:
            fname, val = selected[0]
            if not getattr(d, fname):
                setattr(d, fname, val)

        elif len(selected) == 2:
            vals = [val for fname, val in selected]
            big, small = sorted(vals, reverse=True)

            if not d.height:
                d.height = big
            if not d.width:
                d.width = small

        elif len(selected) == 3:
            if not d.height:
                d.height = self.height
            if not d.width:
                d.width = self.width
            if not d.depth:
                d.depth = self.depth

    def make_group_items(self):
        """Tổng hợp từ bảng items sang group_items"""
        grouped = {}

        for d in self.items:
            if not d.item_code:
                continue

            key = (d.item_code, d.uom, d.rate)
            qty_total = (d.qty_per_unit or 0) * (d.qty or 0)

            if key not in grouped:
                grouped[key] = {
                    "item_code": d.item_code,
                    "uom": d.uom,
                    "rate": d.rate or 0,
                    "total_qty": qty_total,
                }
            else:
                grouped[key]["total_qty"] += qty_total

        self.set("group_items", [])

        for k, row in grouped.items():
            row["amount"] = row["total_qty"] * row["rate"]
            self.append("group_items", row)
