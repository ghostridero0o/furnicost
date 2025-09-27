from frappe.model.document import Document
from frappe.utils import flt
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
        self.calculate_cost_breakdown()
        self.calculate_total_amount()

        # Tổng hợp group_items
        self.make_group_items()

        # Tính lại rate_per_unit
        self.calculate_rate_per_unit()

        # Tính rate_bg
        self.calculate_rate_bg()
        

    def calculate_rate_per_unit(self):
        """Tính lại rate_per_unit"""
        total_amount = self.total_amount or 0
        kl_bg = self.kl_bg or 1  # Đảm bảo kl_bg không phải là NaN hoặc 0

        if kl_bg > 0:
            self.rate_per_unit = total_amount / kl_bg
        else:
            self.rate_per_unit = 0

    def calculate_rate_bg(self):
        """rate_bg = rate_per_unit / (1 - margin/100), giống JS"""
        rate_per_unit = flt(self.rate_per_unit) or 0
        margin = flt(self.margin) or 0

        if rate_per_unit > 0:
            denom = 1 - (margin / 100.0)
            # Tránh chia cho 0 nếu margin = 100%
            self.rate_bg = flt(rate_per_unit / denom) if denom != 0 else 0
        else:
            self.rate_bg = 0

    def update_qty_per_unit_and_amount(self):
        """Tính qty_per_unit, rate (nếu có conversion), và amount"""
        for d in self.items:
            # Đồng bộ rate nếu uom khác stock_uom
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

    def apply_dimension_logic(self, d, part):
        dims = [
            ("is_fix_height", "height", self.height),
            ("is_fix_width", "width", self.width),
            ("is_fix_depth", "depth", self.depth),
        ]

        selected = [(fname, val) for flag, fname, val in dims if getattr(part, flag, 0)]

        # ✅ Kiểm tra nếu depth đã được nhập thủ công, không tự động thay đổi
        if d.depth and d.depth != part.default_thickness:
            return  # Nếu depth đã được set thủ công, bỏ qua phần gán giá trị default_thickness

        # ✅ Luôn luôn gán default_thickness nếu có và không có giá trị thủ công từ người dùng
        if getattr(part, "default_thickness", None) and not d.depth:
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
    def calculate_cost_breakdown(self):
        # reset
        self.vat_tu_chinh = 0
        self.nc = 0
        self.hàng_thương_mại = 0

        # duyệt qua bảng con costing_items
        for row in self.items:
            amount = flt(row.amount)

            if row.cost_type == "Vật tư chính":
                self.vat_tu_chinh += amount
            elif row.cost_type == "Nhân công":
                self.nc += amount
            elif row.cost_type == "Hàng thương mại":
                self.hàng_thương_mại += amount
        # tính chi phí sản xuất chung = nc * %/100
        self.chi_phi_sxc = self.nc * (flt(self.chi_phi_sxc_per) / 100.0)
  
    def calculate_total_amount(self):
        """Tính tổng amount từ bảng items và tổng hợp theo cost type"""
        # Tổng từ bảng con items (raw)
        self.items_amount = sum((flt(d.amount) for d in self.items))

        # Tổng hợp chi phí
        self.total_amount = (
            flt(self.vat_tu_chinh)
            + flt(self.nc)
            + flt(self.hàng_thương_mại)
            + flt(self.chi_phi_sxc)
            + flt(self.vat_tu_phu)
        )
