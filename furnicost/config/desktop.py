# furnicost/config/desktop.py

from frappe import _

def get_data():
    return [
        {
            "module_name": "FurniCost",  # Tên của module
            "category": "Modules",  # Loại danh mục (Modules)
            "label": _("FurniCost"),  # Tiêu đề của module hiển thị
            "color": "#4a90e2",  # Màu sắc của module
            "icon": "octicon octicon-cube",  # Biểu tượng của module (FontAwesome hoặc Octicons)
            "type": "module",  # Loại của module
            "description": _("Furniture costing management")  # Mô tả về module
        }
    ]
