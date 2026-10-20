# Standard Price List và BOQ

Mỗi Standard Price List gồm tên bảng giá, trạng thái Disabled, ghi chú và bảng con
Standard Price List Item. Mã item không được trùng trong cùng bảng giá.
Mô hình Standard Price độc lập đã được loại bỏ.

Bảng con lưu Item Code, Item Name, Hạng mục, vật liệu thùng/cánh/hậu, mô tả,
đơn vị và giá bán. System Manager và Sales Manager được tạo/sửa; Sales User được đọc.

Trong BOQ, chọn **Get Items From → Standard Price List**, chọn bảng giá, lọc các
cột và tick dòng cần lấy. Nút ▾ cho phép tìm giá trị, chọn nhiều giá trị,
sắp xếp và xóa bộ lọc. Lựa chọn được giữ khi lọc và chuyển trang.

| Standard Price List Item | BOQ Item |
| --- | --- |
| item_code | item_code |
| category | item_name |
| description | material_description |
| uom | uom |
| rate | rate |

Các dòng được nối vào BOQ, số lượng mặc định 1. Nhập kích thước cho m2, md hoặc m3.
Item Code không nằm trong các cột mặc định; mở chi tiết dòng để xem khi có mã.
Giá được chép nguyên, không quy đổi tiền tệ và không tự cập nhật khi bảng giá thay đổi.

**Upload Excel** dưới bảng con hỗ trợ file .xlsx tối đa 5 MB, cột tiếng Việt hoặc
tiếng Anh, và file Phú Châu hai sheet ghép theo mã. Xem trước 20 dòng và các lỗi,
chọn thêm mới, cập nhật theo mã hoặc thay toàn bộ bảng. Dòng thiếu giá, mã trùng,
giá sai và đơn vị chưa tồn tại được báo và bỏ qua. Bấm Save để lưu.

**Download Excel** xuất toàn bộ dòng trên form, gồm sửa đổi chưa Save, đủ chín cột.
File xuất ra có thể upload lại. Item Name cho phép 500 ký tự.

Khi tạo Sales Order từ BOQ, Item Code được để trống. Đơn giá và đơn vị được lưu
riêng trên từng dòng để giữ nguyên khi chọn hoặc đổi ERPNext Item. Hệ số quy đổi
được lấy theo Item mới và đơn vị từ BOQ. Dòng không có nguồn BOQ không bị khóa giá.
Sales Order cũ chưa có dữ liệu nguồn/snapshot không được tự động cập nhật.

Sau khi triển khai source mới, chạy migrate và xóa cache trên site để đồng bộ
DocType và tạo các Custom Field giữ giá/đơn vị trên Sales Order Item. Source nằm
trong container local cần được đưa vào Docker image ở lần build tiếp theo.
