cmake_minimum_required(VERSION 3.10)
project(FastChat VERSION 0.1 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(broker src/broker/broker_main.cpp src/common/base64.h)
add_executable(client src/client/client_main.cpp src/common/base64.h)

if (WIN32)
  target_compile_definitions(broker PRIVATE WINDOWS)
  target_compile_definitions(client PRIVATE WINDOWS)
  target_link_libraries(broker PRIVATE ws2_32)
  target_link_libraries(client PRIVATE ws2_32)
endif()
