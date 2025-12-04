# FastChat — Publish/Subscribe Chat System

Mô tả ngắn
---
FastChat là một hệ thống chat theo mô hình publish/subscribe gồm 3 thành phần chính:

- Broker (Server) — chịu trách nhiệm định tuyến các thông điệp giữa các client.
- Gateway (Node.js) — (tùy chọn) phục vụ giao diện Web và cầu nối WebSocket ↔ TCP tới Broker.
- Clients — có thể là client console (C/C++) hoặc Web client (HTML/JS). Mỗi client vừa đóng vai trò Publisher (gửi) vừa là Subscriber (nhận).

Yêu cầu chính
---
- Chat 1‑1 (người dùng chat trực tiếp với nhau)
- Chat nhóm (nhắn tới một topic nhóm)
- Gửi file 1‑1
- Gửi file cho một nhóm
- Các chức năng mở rộng: chơi game (X/O), voice chat, v.v. (tùy chọn)

Môi trường
---
- Hệ điều hành: Windows (phát triển & chạy trên Windows)
- Ngôn ngữ: C, C++ cho Broker / console clients; Node.js cho gateway; HTML/CSS/JS cho web client

Kiến trúc & giao thức
---

1) Tổng quan

- Broker lắng nghe kết nối TCP (ví dụ: 127.0.0.1:12345). Các client kết nối tới Broker và gửi các dòng (line-based protocol).
- Gateway (Node.js) có thể được chạy trên cùng máy và nhận WebSocket từ trình duyệt, chuyển đổi JSON ↔ line protocol tới Broker.
- Các client đăng ký bằng nickname, Broker giữ danh sách clients hiện có và chuyển tiếp các message.

2) Dạng thông điệp (text-line protocol)

Các dòng trao đổi giữa gateway/broker có định dạng đơn giản — các trường phân tách bởi ký tự `|`:

- CONNECT|nick
- USERS|nick1,nick2,...   (danh sách users hiện tại)
- PUBLISH|from|TO_TYPE|target|KIND|payload
  - TO_TYPE: USER hoặc GROUP
  - KIND: TEXT | FILE | ...
  - payload: chuỗi dữ liệu (với FILE payload là `filename::base64`)
- MSG|...  (broker -> gateway forwarding)
- FILE|... (broker -> gateway forwarding)
- END|nick   (user disconnect/finish)

Ví dụ: một tin nhắn text private

PUBLISH|alice|USER|bob|TEXT|Xin chào Bob

Ví dụ: gửi file (payload):

PUBLISH|alice|USER|bob|FILE|avatar.png::<base64-encoded-data>

Giao thức game X/O (client-side messages embedded in TEXT)
---

Để giữ Broker đơn giản, các chỉ thị điều khiển trò chơi được gói trong payload TEXT với tiền tố `GAME::XO::ACTION::DATA`.

Các ACTION chính:
- CHALLENGE — gửi lời mời chơi
- ACCEPT — chấp nhận lời mời
- DECLINE — từ chối
- MOVE — di chuyển: DATA = "r,c"
- END — kết thúc trò chơi: DATA có thể là `WIN::nick::[json_line]` hoặc `DRAW` hoặc `QUIT::nick`

Thiết kế chương trình (chi tiết thuật toán)
---

Broker (C/C++)
- Lắng nghe kết nối TCP.
- Với mỗi client kết nối, duy trì thread (hoặc loop) để đọc dòng từ socket.
- Nhận CONNECT|nick, đăng ký nick -> socket mapping.
- Khi nhận PUBLISH, phân tích toType/kind/target và chuyển tiếp:
  - Nếu toType == USER: tìm socket của target và gửi dòng MSG|from|USER|target|payload
  - Nếu toType == GROUP: gửi tới mọi thành viên đã đăng ký (có thể gửi cả người gửi)
- Định nghĩa: Broker không lưu lịch sử group persist, lưu private session tạm thời ở client (sessionStorage trên web client).

Client console (C/C++)
- Kết nối tới Broker bằng TCP.
- Gửi CONNECT|nick sau khi kết nối.
- Giao diện: dòng lệnh cho phép gửi text, gửi file (mã hoá base64), nhận và hiển thị tin nhắn.

Gateway (Node.js)
- Phục vụ static files (web/public) cho UI.
- Chấp nhận WebSocket từ browser; khi nhận message JSON từ browser, chuyển sang line protocol tới broker và ngược lại.

Web client (HTML/JS)
- Kết nối WebSocket tới Gateway.
- Sau login (nickname), gửi { type: 'connect', nick } → gateway → broker.
- Gửi publish (private/group) bằng JSON: { type:'publish', toType:'USER'|'GROUP', target, kind:'TEXT'|'FILE', payload }
- Lưu private conversation vào sessionStorage (session-only) — sẽ bị xoá khi end session hoặc đóng tab.
- Khi nhận GAME::XO::... sẽ hiển thị UI chấp nhận/đấu (không dùng confirm() để tránh bị trình duyệt chặn). Khi accept, hiển thị board X/O 3x3 và đồng bộ di chuyển qua các payload MOVE.

Các quyết định thiết kế quan trọng
---
- Broker đơn giản (stateless routing) — không lưu group history theo yêu cầu.
- Game được điều khiển bởi message giữa clients (client-driven). Lưu ý: có khả năng bị desync nếu mạng lỗi; nếu cần độ chính xác, có thể thêm authoritative game-state ở Gateway/Broker.
- File được gửi dưới dạng base64 trong payload — gateway/web client hiện hiển thị ảnh inline nếu là ảnh và cung cấp link Download cho file.
- Private chat history: lưu trong sessionStorage (chỉ tồn tại trong phiên trình duyệt). Group history không lưu persistent server-side.

Chạy trên Windows — hướng dẫn nhanh
---
Yêu cầu môi trường:
- Visual Studio / g++/mingw để build C/C++ broker & client.
- Node.js 16+ để chạy gateway.

Build & Run
1) Broker (C++)
- Mở PowerShell, vào thư mục `src/broker` và build theo hướng dẫn (ví dụ dùng Visual Studio hoặc g++)
- Ví dụ (MinGW/g++):

  g++ -std=c++11 -O2 server.cpp -o ../../build/server.exe -lws2_32

2) Gateway (Node.js)
- Cài đặt phụ thuộc và chạy:

  cd web
  npm install
  node server.js

Gateway mặc định lắng nghe Web (HTTP/WS) trên cổng 3000 và kết nối tới Broker TCP tại 127.0.0.1:12345.

3) Web client
- Mở trình duyệt tới http://localhost:3000, nhập nickname và bắt đầu chat.

Luồng kiểm thử (manual)
---
1) Start broker (server.exe)
2) Start gateway (node server.js)
3) Mở hai tab trình duyệt, đăng nhập hai nick khác nhau
4) Thử chat 1‑1: open chat, gửi text
5) Thử gửi file ảnh 1‑1
6) Thử chat nhóm: gửi tin tới `Group` panel
7) Thử chơi X/O: một người gửi CHALLENGE (Play X/O), người kia bấm Accept → board xuất hiện ở cả hai bên, chơi đến khi thắng/hòa

Mở rộng và cải tiến tiếp theo
---
- Di chuyển game state lên Gateway/Broker để tránh desync.
- Thêm authentication/authorization (token-based) nếu dùng qua mạng.
- Thêm per-move timer, better UX/animations cho board, và persistent chat history (database) nếu cần.

Cấu trúc file chính
---
- src/broker/server.cpp — Broker (C++)
- src/client/client.cpp — Console client (C++)
- web/server.js — Node gateway (WebSocket ↔ Broker)
- web/public/index.html — Web UI
- web/public/app.js — Web UI logic (WebSocket client + UI + game)
- web/public/style.css — Styles
- build/ — chứa binary (server.exe, client.exe) khi build xong

Ghi chú cuối
---
README này mô tả kiến trúc hiện tại và các quyết định kỹ thuật. Nếu bạn muốn tôi mở rộng README với ví dụ message traces, diagram kiến trúc, hoặc hướng dẫn build chi tiết theo Visual Studio (MSVC), hãy cho biết; tôi sẽ cập nhật tiếp.

---
Last updated: 2025-12-05
# FastChat — Prototype publish/subscribe chat (console)

This is a minimal prototype for the FastChat project (Broker + Client) in C++ targeting Windows (Winsock).

Features implemented in prototype:
- Broker (server) accepts client connections, manages online users and forwards messages.
- Client console UI: nickname input, Dashboard (All User / Inbox / Group Chat / End Session).
- Private messages and Group "main" channel.
- File send using base64 encoding (sent as single message). Received files are saved as recv_<filename>.

Build (Windows with CMake + MSVC):

Open a Developer Powershell and run:

```powershell
cmake -S . -B build -A x64
cmake --build build --config Release
```

This produces two executables under `build`: `broker.exe` and `client.exe`.

Run:

```powershell
# In terminal 1
.\build\Release\broker.exe

# In terminal 2
.\build\Release\client.exe
```

Notes:
- This is a teaching/assignment prototype. File transfer uses base64 and sends entire file in one message (not chunked/resumable).
- The broker and client are intentionally simple to keep the example readable.