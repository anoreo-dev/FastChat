// server.cpp
#ifdef _WIN32
#define _WINSOCK_DEPRECATED_NO_WARNINGS
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32.lib")
#else
#include <sys/socket.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <errno.h>
#endif

#include <iostream>
#include <array>
#include <thread>
#include <mutex>
#include <unordered_map>
#include <string>
#include <sstream>
#include <vector>
#include <fstream>
#include <sys/stat.h>
#include <ctime>
#ifdef _WIN32
#include <direct.h>
#endif

using namespace std;

#ifdef _WIN32
using sock_t = SOCKET;
#else
using sock_t = int;
#ifndef INVALID_SOCKET
#define INVALID_SOCKET -1
#endif
#endif

static mutex g_mutex;
static unordered_map<string, sock_t> g_clients; // nickname -> socket
// Game manager for authoritative X/O games
struct Game {
    string id;
    string a; // challenger
    string b; // accepter
    char board[3][3];
    string turn; // nick whose turn
    bool started;
    string winner;
};

static unordered_map<string, Game> g_games; // gameId -> Game
static int g_game_counter = 1;

// helper to create a new game id
string make_game_id() {
    return string("g") + to_string(g_game_counter++);
}

// check win; returns winning symbol 'X' or 'O' or '\0'; also fills line indexes if win
char check_win_char(char b[3][3], vector<pair<int,int>>& line) {
    vector<array<pair<int,int>,3>> lines = {
        array<pair<int,int>,3>{{{0,0},{0,1},{0,2}}}, array<pair<int,int>,3>{{{1,0},{1,1},{1,2}}}, array<pair<int,int>,3>{{{2,0},{2,1},{2,2}}},
        array<pair<int,int>,3>{{{0,0},{1,0},{2,0}}}, array<pair<int,int>,3>{{{0,1},{1,1},{2,1}}}, array<pair<int,int>,3>{{{0,2},{1,2},{2,2}}},
        array<pair<int,int>,3>{{{0,0},{1,1},{2,2}}}, array<pair<int,int>,3>{{{0,2},{1,1},{2,0}}}
    };
    for (auto &ln : lines) {
        char a = b[ln[0].first][ln[0].second];
        char c = b[ln[1].first][ln[1].second];
        char d = b[ln[2].first][ln[2].second];
        if (a && a == c && a == d) {
            line.clear();
            line.push_back(ln[0]); line.push_back(ln[1]); line.push_back(ln[2]);
            return a;
        }
    }
    return '\0';
}

// send_all: đảm bảo gửi đủ bytes
bool send_all(sock_t s, const char* data, size_t len) {
    size_t sent = 0;
    while (sent < len) {
#ifdef _WIN32
        int rv = send(s, data + sent, (int)(len - sent), 0);
#else
        ssize_t rv = send(s, data + sent, len - sent, 0);
#endif
        if (rv <= 0) return false;
        sent += (size_t)rv;
    }
    return true;
}

void send_line(sock_t s, const string& line) {
    string msg = line + "\n";
    bool ok = send_all(s, msg.c_str(), msg.size());
    if (!ok) {
        // optional: log failure
        cerr << "[server] send failed to socket " << s << " (closing?)\n";
    }
}

vector<string> split(const string& s, char delim) {
    vector<string> out;
    string token;
    for (size_t i=0, j; i<=s.size(); ++i) {
        if (i==s.size() || s[i]==delim) {
            out.push_back(s.substr(j=i>0?i:0, 0)); // dummy to satisfy compiler - replaced below
        }
    }
    // simpler: use istringstream
    {
        out.clear();
        string tmp; 
        std::istringstream iss(s);
        while (std::getline(iss, tmp, delim)) out.push_back(tmp);
    }
    return out;
}

void broadcast_users_locked() {
    string list = "USERS|";
    bool first = true;
    for (auto &p : g_clients) {
        if (!first) list += ",";
        list += p.first;
        first = false;
    }
    for (auto &p : g_clients) {
        send_line(p.second, list);
    }
}

void broadcast_users() {
    lock_guard<mutex> lk(g_mutex);
    broadcast_users_locked();
}

static string trim_cr(const string& s) {
    if (!s.empty() && s.back() == '\r') return s.substr(0, s.size()-1);
    return s;
}

void handle_client(sock_t client_socket) {
    string readbuf; // accumulate data
    char tmp[4096];
    string nickname;

    while (true) {
#ifdef _WIN32
        int n = recv(client_socket, tmp, (int)sizeof(tmp), 0);
#else
        ssize_t n = recv(client_socket, tmp, sizeof(tmp), 0);
#endif
        if (n <= 0) {
            // disconnected
            break;
        }
        readbuf.append(tmp, tmp + n);

        // process full lines delimited by '\n'
        size_t pos;
        while ((pos = readbuf.find('\n')) != string::npos) {
            string line = readbuf.substr(0, pos);
            readbuf.erase(0, pos + 1);
            line = trim_cr(line);
            if (line.empty()) continue;

            // parse
            auto parts = split(line, '|');
            if (parts.empty()) continue;
            string cmd = parts[0];

            if (cmd == "CONNECT") {
                if (parts.size() >= 2) {
                    string nick = parts[1];
                    lock_guard<mutex> lk(g_mutex);
                    if (g_clients.find(nick) != g_clients.end()) {
                        send_line(client_socket, "CONNECTED|NICK_TAKEN");
                        cerr << "[server] CONNECT rejected for " << nick << " (taken)\n";
                    } else {
                        nickname = nick;
                        g_clients[nick] = client_socket;
                        send_line(client_socket, "CONNECTED|OK");
                        cerr << "[server] CONNECT OK: " << nick << "\n";
                        broadcast_users_locked();
                    }
                }
            } else if (cmd == "PUBLISH") {
                // PUBLISH|from|USER/GROUP|target|TEXT/FILE|payload
                if (parts.size() >= 6) {
                    string from = parts[1];
                    string to_type = parts[2];
                    string target = parts[3];
                    string kind = parts[4];
                    string payload = parts[5];

                    cerr << "[server] PUBLISH from=" << from << " to_type=" << to_type
                         << " target=" << target << " kind=" << kind << "\n";

                    lock_guard<mutex> lk(g_mutex);
                    // If payload is a GAME command, handle authoritative game logic here
                    if (kind == "TEXT" && payload.rfind("GAME::XO::", 0) == 0 && to_type == "USER") {
                        // parse GAME payload parts
                        // format: GAME::XO::ACTION::DATA...
                        // We'll locate the separators explicitly so `data` is the substring after
                        // the third '::' (if present), and `action` is the 3rd segment.
                        string action;
                        string data = "";
                        size_t p1 = payload.find("::");
                        if (p1 != string::npos) {
                            size_t p2 = payload.find("::", p1 + 2);
                            if (p2 != string::npos) {
                                // find third separator (may not exist)
                                size_t p3 = payload.find("::", p2 + 2);
                                // action is between p2+2 and p3 (or end)
                                if (p3 != string::npos) {
                                    action = payload.substr(p2 + 2, p3 - (p2 + 2));
                                    data = payload.substr(p3 + 2);
                                } else {
                                    action = payload.substr(p2 + 2);
                                    data = "";
                                }
                            }
                        }

                        if (action == "CHALLENGE") {
                            // create game and send INVITE to target with game id
                            string gid = make_game_id();
                            Game G;
                            G.id = gid; G.a = from; G.b = target; G.started = false; G.winner = ""; G.turn = "";
                            for (int i=0;i<3;i++) for (int j=0;j<3;j++) G.board[i][j] = 0;
                            g_games[gid] = G;
                            // send INVITE message to target: MSG|from|USER|target|GAME::XO::INVITE::gid::from
                            auto it = g_clients.find(target);
                            if (it != g_clients.end()) {
                                string out = "MSG|" + from + "|USER|" + target + "|GAME::XO::INVITE::" + gid + "::" + from;
                                send_line(it->second, out);
                                cerr << "[server] sent INVITE " << gid << " to " << target << "\n";
                            } else {
                                cerr << "[server] target NOT FOUND for INVITE: " << target << "\n";
                            }
                            // also send ACK to challenger (optional)
                            auto itf = g_clients.find(from);
                            if (itf != g_clients.end()) send_line(itf->second, "MSG|server|USER|" + from + "|GAME::XO::CHALLENGE_SENT::" + gid);
                            continue; // handled
                        } else if (action == "ACCEPT") {
                                // data should be game id
                                string gid = data;
                                // If gid not provided (legacy client), try to locate a pending game
                                // where challenger (a) == target and accepter (b) == from
                                if (gid.empty()) {
                                    for (auto &pg : g_games) {
                                        if (pg.second.a == target && pg.second.b == from && !pg.second.started) {
                                            gid = pg.first;
                                            break;
                                        }
                                    }
                                    if (gid.empty()) { cerr << "[server] ACCEPT missing game id and no pending game found\n"; continue; }
                                }
                                auto git = g_games.find(gid);
                                if (git == g_games.end()) { cerr << "[server] ACCEPT unknown gid " << gid << "\n"; continue; }
                            Game &G = git->second;
                            // ensure acceptor is target
                            if (from != G.b) {
                                cerr << "[server] ACCEPT from unexpected user " << from << " expected " << G.b << "\n";
                                continue;
                            }
                            // start game: challenger=A is X, accepter=B is O, turn = challenger
                            G.started = true;
                            G.turn = G.a;
                            // send STATE to both players (as JSON payload)
                            // JSON: {"gameId":"gid","board":["","",...],"turn":"nick","you":"X"}
                            auto make_state = [&](const string &nick)->string{
                                string s = "{";
                                s += "\"gameId\":\"" + gid + "\",";
                                s += "\"board\":[";
                                for (int i=0;i<3;i++) for (int j=0;j<3;j++) {
                                    string cell = "\"";
                                    if (G.board[i][j]) cell = string("\"") + G.board[i][j] + string("\"");
                                    else cell = string("\"\"");
                                    s += cell;
                                    if (!(i==2 && j==2)) s += ",";
                                }
                                s += "],";
                                s += "\"turn\":\"" + G.turn + "\",";
                                // you symbol
                                string you = (nick == G.a) ? string("X") : string("O");
                                s += "\"you\":\"" + you + "\"";
                                s += "}";
                                return s;
                            };
                            auto ita = g_clients.find(G.a);
                            auto itb = g_clients.find(G.b);
                            if (ita != g_clients.end()) send_line(ita->second, "MSG|server|USER|" + G.a + "|GAME::XO::STATE::" + make_state(G.a));
                            if (itb != g_clients.end()) send_line(itb->second, "MSG|server|USER|" + G.b + "|GAME::XO::STATE::" + make_state(G.b));
                            cerr << "[server] started game " << gid << " between " << G.a << " and " << G.b << "\n";
                            continue;
                        } else if (action == "MOVE") {
                            // data expected: gid::r,c
                            size_t p = data.find("::");
                            if (p == string::npos) { cerr << "[server] MOVE malformed\n"; continue; }
                            string gid = data.substr(0,p);
                            string rc = data.substr(p+2);
                            auto git = g_games.find(gid);
                            if (git == g_games.end()) { cerr << "[server] MOVE unknown gid " << gid << "\n"; continue; }
                            Game &G = git->second;
                            if (!G.started) { cerr << "[server] MOVE but game not started\n"; continue; }
                            if (from != G.turn) { cerr << "[server] MOVE wrong turn from " << from << " expected " << G.turn << "\n"; continue; }
                            int r=-1,c=-1;
                            if (sscanf(rc.c_str(), "%d,%d", &r, &c) != 2) { cerr << "[server] MOVE parse failed\n"; continue; }
                            if (r<0||r>2||c<0||c>2) { cerr << "[server] MOVE out of range\n"; continue; }
                            if (G.board[r][c]) { cerr << "[server] MOVE cell occupied\n"; continue; }
                            char sym = (from == G.a) ? 'X' : 'O';
                            G.board[r][c] = sym;
                            // check win or draw
                            vector<pair<int,int>> wline;
                            char w = check_win_char(G.board, wline);
                            if (w) {
                                G.started = false;
                                G.winner = (w == 'X') ? G.a : G.b;
                                // send END::WIN::nick::[line_json]
                                // create line json: [[r,c],...]
                                string linejson = "[";
                                for (size_t i=0;i<wline.size();i++) {
                                    linejson += "[" + to_string(wline[i].first) + "," + to_string(wline[i].second) + "]";
                                    if (i+1<wline.size()) linejson += ",";
                                }
                                linejson += "]";
                                auto ita2 = g_clients.find(G.a);
                                auto itb2 = g_clients.find(G.b);
                                string payload = "GAME::XO::END::WIN::" + G.winner + "::" + linejson;
                                if (ita2!=g_clients.end()) send_line(ita2->second, "MSG|server|USER|" + G.a + "|" + payload);
                                if (itb2!=g_clients.end()) send_line(itb2->second, "MSG|server|USER|" + G.b + "|" + payload);
                                cerr << "[server] game " << gid << " won by " << G.winner << "\n";
                            } else {
                                // check draw
                                bool full=true; for (int i=0;i<3;i++) for (int j=0;j<3;j++) if (!G.board[i][j]) full=false;
                                if (full) {
                                    G.started = false;
                                    auto ita2 = g_clients.find(G.a);
                                    auto itb2 = g_clients.find(G.b);
                                    string payload = "GAME::XO::END::DRAW";
                                    if (ita2!=g_clients.end()) send_line(ita2->second, "MSG|server|USER|" + G.a + "|" + payload);
                                    if (itb2!=g_clients.end()) send_line(itb2->second, "MSG|server|USER|" + G.b + "|" + payload);
                                    cerr << "[server] game " << gid << " draw\n";
                                } else {
                                    // switch turn and send STATE to both
                                    G.turn = (G.turn == G.a) ? G.b : G.a;
                                    auto make_state2 = [&](const string &nick)->string{
                                        string s = "{";
                                        s += "\"gameId\":\"" + gid + "\",";
                                        s += "\"board\":[";
                                        for (int i=0;i<3;i++) for (int j=0;j<3;j++) {
                                            string cell = "\"";
                                            if (G.board[i][j]) cell = string("\"") + G.board[i][j] + string("\"");
                                            else cell = string("\"\"");
                                            s += cell;
                                            if (!(i==2 && j==2)) s += ",";
                                        }
                                        s += "],";
                                        s += "\"turn\":\"" + G.turn + "\",";
                                        string you = (nick == G.a) ? string("X") : string("O");
                                        s += "\"you\":\"" + you + "\"";
                                        s += "}";
                                        return s;
                                    };
                                    auto ita3 = g_clients.find(G.a);
                                    auto itb3 = g_clients.find(G.b);
                                    if (ita3!=g_clients.end()) send_line(ita3->second, "MSG|server|USER|" + G.a + "|GAME::XO::STATE::" + make_state2(G.a));
                                    if (itb3!=g_clients.end()) send_line(itb3->second, "MSG|server|USER|" + G.b + "|GAME::XO::STATE::" + make_state2(G.b));
                                }
                            }
                            continue;
                        }
                        // fallback: not handled here
                    }
                    if (to_type == "GROUP") {
                        for (auto &p : g_clients) {
                            // send to all clients including the sender so everyone's UI (including sender) shows the group message
                            if (kind == "TEXT") {
                                string out = "MSG|" + from + "|GROUP|" + target + "|" + payload;
                                send_line(p.second, out);
                            } else {
                                string out = "FILE|" + from + "|GROUP|" + target + "|" + payload;
                                send_line(p.second, out);
                            }
                        }
                        // NOTE: persistence disabled — do not save group messages to disk
                    } else if (to_type == "USER") {
                        auto it = g_clients.find(target);
                        if (it == g_clients.end()) {
                            cerr << "[server] target NOT FOUND: " << target << "\n";
                        } else {
                            sock_t dest = it->second;
                            string out = (kind == "TEXT")
                                         ? "MSG|" + from + "|USER|" + target + "|" + payload
                                         : "FILE|" + from + "|USER|" + target + "|" + payload;
                            send_line(dest, out);
                            cerr << "[server] forwarded to " << target << " (socket=" << dest << ")\n";
                        }
                    }
                } else {
                    cerr << "[server] PUBLISH malformed: " << line << "\n";
                }
            } else if (cmd == "END") {
                if (parts.size() >= 2) {
                    string nick = parts[1];
                    lock_guard<mutex> lk(g_mutex);
                    auto it = g_clients.find(nick);
                    if (it != g_clients.end()) {
                        g_clients.erase(it);
                        cerr << "[server] END removed: " << nick << "\n";
                        broadcast_users_locked();
                    }
                }
            } else {
                cerr << "[server] unknown cmd: " << cmd << "\n";
            }
        } // while lines
    } // while recv

    // cleanup
    if (!nickname.empty()) {
        lock_guard<mutex> lk(g_mutex);
        g_clients.erase(nickname);
        cerr << "[server] client disconnected: " << nickname << "\n";
        broadcast_users_locked();
    }

#ifdef _WIN32
    closesocket(client_socket);
#else
    ::close(client_socket);
#endif
}

int main() {
#ifdef _WIN32
    WSADATA wsa;
    WSAStartup(MAKEWORD(2,2), &wsa);
#endif

    const int port = 12345;

    sock_t listen_sock =
#ifdef _WIN32
        socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
#else
        socket(AF_INET, SOCK_STREAM, 0);
#endif

    if (listen_sock == INVALID_SOCKET) {
        cerr << "Failed to create socket\n";
        return 1;
    }

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port = htons(port);

    if (bind(listen_sock, (sockaddr*)&addr, sizeof(addr)) == -1) {
    // print platform-specific error to help debugging (port in use, permissions, etc.)
#ifdef _WIN32
    int err = WSAGetLastError();
    cerr << "Bind failed: WSA error " << err << "\n";
#else
    cerr << "Bind failed: " << strerror(errno) << " (" << errno << ")\n";
#endif
    return 1;
    }

    if (listen(listen_sock, 10) == -1) {
        cerr << "Listen failed\n";
        return 1;
    }

    cerr << "[server] Broker listening on port " << port << "\n";

    while (true) {
        sockaddr_in client_addr{};
        socklen_t len = sizeof(client_addr);
        sock_t client =
#ifdef _WIN32
            accept(listen_sock, (sockaddr*)&client_addr, &len);
#else
            accept(listen_sock, (sockaddr*)&client_addr, &len);
#endif
        if (client == INVALID_SOCKET) continue;

        thread t(handle_client, client);
        t.detach();
    }

#ifdef _WIN32
    WSACleanup();
#endif
    return 0;
}
