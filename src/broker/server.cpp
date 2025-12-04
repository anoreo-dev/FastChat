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
        cerr << "Bind failed\n";
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
