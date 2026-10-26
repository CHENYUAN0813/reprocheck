"""Managed loopback service; stdin EOF shuts down when the Node parent exits."""
import socket
import sys
import threading

import uvicorn


def main():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(('127.0.0.1', 0))
    config = uvicorn.Config('backend.app:app', log_level='error', access_log=False,
                            timeout_graceful_shutdown=5, proxy_headers=False)
    server = uvicorn.Server(config)

    def parent_lifetime():
        sys.stdin.buffer.read()
        server.should_exit = True

    threading.Thread(target=parent_lifetime, daemon=True).start()
    print(f'REPROCHECK_SCAN_PORT={sock.getsockname()[1]}', flush=True)
    try:
        server.run(sockets=[sock])
    finally:
        sock.close()


if __name__ == '__main__':
    main()
