# 📦 PackGenius - Minecraft Resource Pack Converter

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express.js">
  <img src="https://img.shields.io/badge/Socket.io-010101?style=for-the-badge&logo=socket.io&logoColor=white" alt="Socket.io">
</p>

**PackGenius** là công cụ chuyển đổi resource pack Minecraft giữa các phiên bản và nền tảng khác nhau. Với giao diện web hiện đại và dễ sử dụng.

## ✨ Tính năng

- 🔄 **Java → Bedrock**: Chuyển đổi resource pack từ Java Edition sang Bedrock Edition
- 🔄 **Bedrock → Java**: Chuyển đổi resource pack từ Bedrock Edition sang Java Edition
- 🔢 **Thay đổi phiên bản Java**: Chuyển đổi pack format giữa các phiên bản Minecraft Java (1.6.1 - 1.21)
- 🎨 **ItemsAdder → Bedrock**: Chuyển đổi plugin ItemsAdder sang định dạng Bedrock

## 🖼️ Giao diện

- Giao diện web hiện đại với hiệu ứng glassmorphism
- Kéo thả file để upload
- Console log realtime hiển thị tiến trình chuyển đổi
- Responsive design

## 🚀 Cài đặt

### Yêu cầu

- Node.js >= 16.x
- npm hoặc yarn

### Các bước cài đặt

1. **Clone repository:**

```bash
git clone https://github.com/kha0305/convert-pack.git
cd convert-pack
```

2. **Cài đặt dependencies:**

```bash
npm install
```

3. **Chạy ứng dụng:**

```bash
npm start
```

4. **Truy cập:** Ứng dụng sẽ tự động mở trình duyệt tại `http://localhost:3000`

## 📁 Cấu trúc thư mục

```
convert-pack/
├── converter/                 # Các module chuyển đổi
│   ├── java-to-bedrock.js    # Java → Bedrock converter
│   ├── bedrock-to-java.js    # Bedrock → Java converter
│   ├── java-version.js       # Java version converter
│   └── itemsadder-to-bedrock.js  # ItemsAdder converter
├── public/                    # Frontend files
│   ├── index.html            # Trang chính
│   ├── style.css             # Styles
│   └── script.js             # Client-side logic
├── uploads/                   # Thư mục upload tạm
├── output/                    # Thư mục output
├── index.js                   # Server chính
├── package.json
└── README.md
```

## 🛠️ Công nghệ sử dụng

| Công nghệ      | Mục đích               |
| -------------- | ---------------------- |
| **Express.js** | Web server framework   |
| **Socket.io**  | Realtime communication |
| **Multer**     | File upload handling   |
| **Sharp**      | Image processing       |
| **ADM-Zip**    | ZIP file handling      |
| **Archiver**   | Tạo file ZIP/MCPACK    |

## 📋 Định dạng hỗ trợ

### Input

- `.zip` - Resource pack dạng ZIP
- `.mcpack` - Bedrock resource pack

### Output

- `.mcpack` - Bedrock resource pack
- `.zip` - Java resource pack

## ⚙️ API Endpoints

| Method | Endpoint          | Mô tả                        |
| ------ | ----------------- | ---------------------------- |
| `POST` | `/api/convert`    | Upload và chuyển đổi pack    |
| `GET`  | `/api/versions`   | Lấy danh sách phiên bản Java |
| `POST` | `/api/clear-temp` | Xóa file tạm                 |

## 🎯 Hướng dẫn sử dụng

1. **Chọn chế độ chuyển đổi** từ dropdown menu
2. **Upload file** bằng cách kéo thả hoặc click để chọn file
3. **Nhấn "Start Conversion"** để bắt đầu
4. **Theo dõi tiến trình** trong console
5. **Tải file** khi hoàn tất (tự động download)

## 📝 Pack Format Reference

| Phiên bản Minecraft | Pack Format |
| ------------------- | ----------- |
| 1.21                | 34          |
| 1.20.5 - 1.20.6     | 32          |
| 1.20.3 - 1.20.4     | 22          |
| 1.20.2              | 18          |
| 1.20 - 1.20.1       | 15          |
| 1.19.4              | 13          |
| 1.19 - 1.19.3       | 12          |
| 1.18 - 1.18.2       | 8           |
| 1.17 - 1.17.1       | 7           |
| 1.16.2 - 1.16.5     | 6           |
| 1.15 - 1.16.1       | 5           |
| 1.13 - 1.14.4       | 4           |
| 1.11 - 1.12.2       | 3           |
| 1.9 - 1.10.2        | 2           |
| 1.6.1 - 1.8.9       | 1           |

## 🤝 Đóng góp

Mọi đóng góp đều được chào đón! Vui lòng tạo Issue hoặc Pull Request.

## 📄 License

ISC License

---

<p align="center">
  Made with ❤️ for Minecraft community
</p>
