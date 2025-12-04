# Simple build script for Windows (MSVC)
cmake -S . -B build -A x64
cmake --build build --config Release
