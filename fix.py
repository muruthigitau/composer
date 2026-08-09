import io
def r(p): return io.open(p, encoding="utf-8").read()
def w(p, c): io.open(p, "w", encoding="utf-8").write(c)

gs = r("src/services/GitService.ts")
print("loaded")