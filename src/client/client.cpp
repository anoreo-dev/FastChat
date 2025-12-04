// client.cpp
#ifdef _WIN32
#define _WINSOCK_DEPRECATED_NO_WARNINGS
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32.lib")
#else
#include <sys/socket.h>
#include <arpa/inet.h>
#include <unistd.h>
#endif

#include <iostream>
#include <thread>
#include <sstream>
#include <string>
#include <vector>

using namespace std;

#ifdef _WIN32
using sock_t = SOCKET;
#else
using sock_t = int;
#ifndef INVALID_SOCKET
#define INVALID_SOCKET -1
#endif
#endif

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
    if (!send_all(s, msg.c_str(), msg.size())) {
        cerr << "[client] send failed\n";
    }
}

vector<string> split(const string& s, char delim) {
    vector<string> out; string tok; istringstream iss(s);
    while (getline(iss, tok, delim)) out.push_back(tok);
    return out;
}

static string trim_cr(const string& s) {
    if (!s.empty() && s.back() == '\r') return s.substr(0, s.size()-1);
    return s;
}

void receiver(sock_t sock) {
    string readbuf;
    char tmp[4096];

    while (true) {
#ifdef _WIN32
        int n = recv(sock, tmp, (int)sizeof(tmp), 0);
#else
        ssize_t n = recv(sock, tmp, sizeof(tmp), 0);
#endif
        if (n <= 0) {
            cout << "Disconnected from server\n";
            break;
        }
        readbuf.append(tmp, tmp + n);

        size_t pos;
        while ((pos = readbuf.find('\n')) != string::npos) {
            string line = readbuf.substr(0, pos);
            readbuf.erase(0, pos + 1);
            line = trim_cr(line);
            if (line.empty()) continue;

            auto parts = split(line, '|');
            if (parts.empty()) continue;

            if (parts[0] == "USERS") {
                cout << "\n[Users] " << (parts.size()>=2?parts[1]:"") << "\n> ";
            } else if (parts[0] == "MSG") {
                // MSG|from|USER/GROUP|target|text
                string from = parts.size()>1?parts[1]:"";
                string target = parts.size()>3?parts[3]:"";
                string text = parts.size()>4?parts[4]:"";
                cout << "\n[MSG from " << from << " -> " << target << "] " << text << "\n> ";
            } else if (parts[0] == "FILE") {
                cout << "\n[FILE] " << (parts.size()>1?parts[1]:"") << " -> " << (parts.size()>3?parts[3]:"") << " : " << (parts.size()>4?parts[4]:"") << "\n> ";
            } else if (parts[0] == "CONNECTED") {
                if (parts.size()>1 && parts[1]=="OK") cout << "Connected OK\n> ";
                else cout << "Nickname rejected\n";
            } else {
                cout << "\n[PROTO] " << line << "\n> ";
            }
            cout.flush();
        }
    }

#ifdef _WIN32
    closesocket(sock);
#else
    ::close(sock);
#endif
}

int main() {
#ifdef _WIN32
    WSADATA wsa;
    WSAStartup(MAKEWORD(2,2), &wsa);
#endif

    string server_ip = "127.0.0.1";
    int server_port = 12345;

    cout << "Enter nickname: ";
    string nick; getline(cin, nick);

    sock_t sock =
#ifdef _WIN32
        socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
#else
        socket(AF_INET, SOCK_STREAM, 0);
#endif
    if (sock == INVALID_SOCKET) {
        cerr << "Cannot create socket\n";
        return 1;
    }

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(server_port);
#ifdef _WIN32
    inet_pton(AF_INET, server_ip.c_str(), &addr.sin_addr);
#else
    inet_aton(server_ip.c_str(), &addr.sin_addr);
#endif

    if (connect(sock, (sockaddr*)&addr, sizeof(addr)) < 0) {
        cerr << "Cannot connect\n";
        return 1;
    }

    // send CONNECT
    send_line(sock, "CONNECT|" + nick);

    thread t(receiver, sock);
    t.detach();

    cout << "Commands:\n  msg user <target> <text>\n  msg group <group> <text>\n  exit\n";

    while (true) {
        cout << "> ";
        string cmd; getline(cin, cmd);
        if (cmd.empty()) continue;
        if (cmd == "exit") {
            send_line(sock, "END|" + nick);
            break;
        }
        // parse simple
        if (cmd.rfind("msg user ", 0) == 0) {
            // msg user target rest...
            size_t p = cmd.find(' ', 9);
            if (p == string::npos) { cout << "Wrong format\n"; continue; }
            string target = cmd.substr(9, p-9);
            string text = cmd.substr(p+1);
            send_line(sock, "PUBLISH|" + nick + "|USER|" + target + "|TEXT|" + text);
            cout << "[sent]\n";
        } else if (cmd.rfind("msg group ", 0) == 0) {
            size_t p = cmd.find(' ', 10);
            if (p == string::npos) { cout << "Wrong format\n"; continue; }
            string group = cmd.substr(10, p-10);
            string text = cmd.substr(p+1);
            send_line(sock, "PUBLISH|" + nick + "|GROUP|" + group + "|TEXT|" + text);
            cout << "[sent]\n";
        } else {
            cout << "Unknown command\n";
        }
    }

#ifdef _WIN32
    closesocket(sock);
    WSACleanup();
#else
    ::close(sock);
#endif
    return 0;
}
