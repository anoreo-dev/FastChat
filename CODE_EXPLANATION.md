# FastChat — Giải thích chi tiết mã nguồn

Tài liệu này giải thích cấu trúc và cách hoạt động của project FastChat (Broker C++ + Node gateway + Web UI). Mục tiêu: giúp bạn hiểu từng thành phần, giao thức, luồng tin nhắn và cách debug khi có sự cố.

---

## Tổng quan kiến trúc

- Broker (C++): một TCP server đơn giản (line-based) đóng vai trò router — nhận kết nối TCP từ gateway, nhận dòng lệnh dạng `CONNECT|...`, `PUBLISH|...`, `END|...` và chuyển tiếp MSG/FILE đến client đích. Broker hiện chứa cả game manager cho Tic-Tac-Toe (X/O) để xử lý trạng thái trò chơi một cách authoritative.
- Gateway (Node.js): HTTP + WebSocket server. Phục vụ UI tĩnh (`web/public`) và từng kết nối WebSocket giữa browser ↔ gateway sẽ được kết nối tới broker bằng TCP (mỗi ws → một tcp socket). Gateway chuyển JSON từ browser thành dòng line protocol gửi tới broker, và ngược lại forward các dòng broker tới browser dưới dạng JSON { source:'broker', line }.
- Web client (HTML/JS/CSS): giao diện UI, WebSocket client tới gateway, lưu private chat trong sessionStorage, hỗ trợ file upload (inline images), và UI/logic chơi X/O dựa vào trạng thái do server gửi (authoritative).

---

## File chính và vai trò

- `src/broker/server.cpp`
  - Khởi tạo socket lắng nghe trên port mặc định `12345`.
  - Giao thức line-based: các lệnh chính:
    - `CONNECT|nick` — client đăng ký nickname
    - `PUBLISH|from|USER|target|TEXT|payload` hoặc `PUBLISH|...|FILE|filename::base64`
    - `END|nick` — client kết thúc
  - Quản lý `g_clients` (map nickname → socket) và broadcast `USERS|nick1,nick2...` khi có thay đổi.
  - Game manager X/O:
    - Khi nhận `PUBLISH` với payload bắt đầu `GAME::XO::` và `to_type == USER`, broker phân tích action (CHALLENGE, ACCEPT, MOVE, END) và xử lý:
      - `CHALLENGE`: tạo `gid` (ví dụ g1) và lưu `Game` tạm; gửi `MSG|from|USER|target|GAME::XO::INVITE::gid::from` tới target
      - `ACCEPT::gid`: khởi game, đặt `turn` = challenger, gửi `GAME::XO::STATE::JSON` (board, turn, you) cho cả 2
      - `MOVE::gid::r,c`: server kiểm tra lượt, hợp lệ, cập nhật board; gửi `STATE` hoặc `END::WIN` / `END::DRAW` tương ứng.
    - `Game` struct lưu board 3x3, players a/b, started, turn, winner.

- `web/server.js` (Gateway)
  - Dùng `express` để serve static files `web/public`.
  - Dùng `ws` để accept connections từ browser. Với mỗi `ws` tạo một TCP `net.Socket()` tới broker.
  - Khi broker gửi data theo dòng (`\n`), gateway forward tới browser: `ws.send(JSON.stringify({ source: 'broker', line }))`.
  - Khi browser gửi JSON messages (connect/publish/end), gateway build line protocol và `broker.write(line)`
  - Biến môi trường hữu ích:
    - `BROKER_HOST`, `BROKER_PORT` (mặc định 127.0.0.1:12345)
    - `PORT` cho gateway HTTP (mặc định 3000)

- `web/public/index.html`
  - Giao diện chính, phân chia sidebar (Users/Inbox/Group) và vùng chat.
  - Có placeholder `div.user-avatar` (bây giờ ưu tiên ảnh `user.png` trong `web/public`) và `#me` để hiển thị nickname.

- `web/public/style.css`
  - Kiểu dáng giao diện; đã chỉnh để ưu tiên font `Inter` (Google Fonts) và avatar lấy từ `user.png` nếu có, fallback sang gradient.

- `web/public/app.js`
  - WebSocket client logic: kết nối đến gateway URL (cùng origin) và gửi JSON `connect` khi đăng nhập.
  - Xử lý các dòng broker (m.source === 'broker'):
    - `USERS|...` → render danh sách users
    - `MSG|from|USER|target|payload` → private message; nếu payload bắt đầu `GAME::XO::` thì gọi `handleXoMessage`
    - `FILE|...` → render inline image nếu là hình
  - Game UI: lưu trạng thái game theo conversation key `chat_a__b` vào `games` object; render board trong `#convGameArea` khi nhận `GAME::XO::STATE::JSON` từ server (server authoritative)
  - Khi người dùng nhấn Play X/O, client gửi `GAME::XO::CHALLENGE` (publish TEXT) tới target. Khi accepter bấm Accept, client gửi `GAME::XO::ACCEPT::gid` (nếu có gid), hoặc trước đây client có thể gửi ACCEPT legacy — broker đã được harden để xử lý.

---

## Giao thức (tóm tắt)

- Broker line protocol (dòng kết thúc bằng `\\n`): simple pipe-separated fields.
- Một số dòng mẫu:
  - CONNECT|alice
  - USERS|alice,bob
  - PUBLISH|alice|USER|bob|TEXT|Hello
  - FILE|alice|USER|bob|image.png::BASE64DATA
  - MSG|server|USER|alice|GAME::XO::INVITE::g1::bob

- Game messages (payload): `GAME::XO::ACTION::DATA...`.
  - INVITE: `GAME::XO::INVITE::gid::inviter`
  - STATE: `GAME::XO::STATE::JSON` với JSON chứa { gameId, board:[9 entries], turn, you }
  - MOVE (client→server): `GAME::XO::MOVE::gid::r,c`
  - END: `GAME::XO::END::WIN::nick::[line_json]` or `...::DRAW`

---

## Cách chạy (tóm tắt)

1. Build broker (Windows): dùng g++ hoặc Visual Studio.
   - g++ example (MinGW-w64 / MSYS2):
     ```powershell
     cd src/broker
     g++ -std=c++17 -O2 server.cpp -o server.exe -lws2_32
     .\\server.exe
     ```
   - Nếu `Bind failed: WSA error 10048` xuất hiện nghĩa là port đang bị chiếm — dùng `netstat -aon | findstr ":12345"` và kill PID nếu an toàn hoặc đổi port trong source.

2. Start gateway (Node):
   ```powershell
   cd web
   npm install
   npm start
   ```

3. Mở trình duyệt: http://localhost:3000 — dùng hai cửa sổ/2 trình duyệt để test 1-1 game.

---

## Debugging tips (những chỗ thường lỗi)

- Nếu người nhận thấy "Đang chờ server tạo trò chơi...": nghĩa là client chưa nhận `INVITE` với `gid` từ server. Kiểm tra thứ tự:
  1. Client challenger có gửi `PUBLISH` với `GAME::XO::CHALLENGE` không? (browser console & gateway log)
  2. Gateway có forward chính xác dòng `PUBLISH|...|GAME::XO::CHALLENGE` tới broker? (gateway terminal logs)
  3. Broker có in `sent INVITE gX to <target>`? Nếu không là bug ở server-side parsing.

- Nếu broker in "ACCEPT unknown gid ACCEPT::g1": nghĩa là broker parse payload sai (đã được sửa) — cần rebuild broker sau patch.

- Để thu thập logs cần paste 3 nguồn cùng thời điểm: broker terminal, gateway terminal, browser console (của cả 2 client). Việc này giúp xác định xem thông tin bị mất ở bước nào (browser→gateway, gateway→broker, hoặc broker→gateway→browser).

---

## Lời khuyên cho cải tiến tiếp theo

- Move gateway → broker messaging to a framed JSON protocol (instead of pipe-separated) để dễ debug và mở rộng.
- Thêm reconnect / resume handling cho games để người chơi có thể reconnect và tiếp tục game dựa trên `gid`.
- Thêm tests tự động: một script Node.js giả lập hai clients để test CHALLENGE→ACCEPT→MOVE→END flow.

---

Nếu bạn muốn, tôi có thể:
- Sinh bản đồ sequence diagrams cho luồng CHALLENGE→ACCEPT→MOVE.
- Viết script test tự động (Node) để mô phỏng hai client và assert các STATE messages.

Hãy nói rõ bạn muốn tôi làm bước tiếp theo nào.
