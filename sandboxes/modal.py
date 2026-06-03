import sys
import modal

app = modal.App("rawtree-modal-hello-world")


@app.function()
def hello(i: int) -> int:
    if i % 2 == 0:
        print("hello", i)
    else:
        print("world", i, file=sys.stderr)

    return i * i


@app.local_entrypoint()
def main():
    print("local:", hello.local(1000))
    print("remote:", hello.remote(1000))

    total = 0
    for result in hello.map(range(20)):
        total += result

    print("total:", total)
