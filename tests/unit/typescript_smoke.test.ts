type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

function divide(a: number, b: number): Result<number> {
  if (b === 0) return { ok: false, reason: "divide by zero" };
  return { ok: true, value: a / b };
}

describe("TypeScript toolchain smoke test", () => {
  it("compiles and runs a discriminated union", () => {
    const ok = divide(10, 2);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value).toBe(5);
  });

  it("handles the error branch", () => {
    const err = divide(1, 0);
    expect(err.ok).toBe(false);
    if (!err.ok) expect(err.reason).toMatch(/divide/);
  });

  it("supports async/await", async () => {
    const v = await Promise.resolve(42);
    expect(v).toBe(42);
  });
});
