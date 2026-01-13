import os, pathlib, sys, re

login_file = pathlib.Path(sys.argv[1])
is_ts = int(sys.argv[2]) == 1
use_next_image = int(sys.argv[3]) == 1

# Heuristic: if this file contains "use client", keep it; otherwise add it (safe for Next app router pages/components)
existing = login_file.read_text(encoding="utf-8", errors="ignore")
has_use_client = 'use client' in existing

# If Next/Image available, we use it; otherwise plain img tags
imports = []
img_logo = ""
img_bg = ""

if use_next_image:
    imports.append("import Image from \"next/image\";")
    img_logo = """
          <Image
            src="/branding/logo.png"
            alt="Optima Dealer Services"
            width={700}
            height={220}
            priority
            className="h-auto w-[680px] max-w-[92vw] select-none"
          />
"""
    img_bg = """
      <Image
        src="/branding/login-bg.png"
        alt=""
        fill
        priority
        className="object-cover object-center"
      />
"""
else:
    img_logo = """
          <img
            src="/branding/logo.png"
            alt="Optima Dealer Services"
            className="h-auto w-[680px] max-w-[92vw] select-none"
            draggable={false}
          />
"""
    img_bg = """
      <img
        src="/branding/login-bg.png"
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-center"
        draggable={false}
      />
"""

# TS/JS handler types
handler_sig = "async function handleSubmit(e: React.FormEvent<HTMLFormElement>)" if is_ts else "async function handleSubmit(e)"

# Fix f-string backslash issue
nl = "\n"
use_client_line = '"use client";' + nl + nl if not has_use_client else ""
imports_line = nl.join(imports) + nl + nl if imports else ""

content = f"""{use_client_line}{imports_line}import React from "react";

export default function LoginPage() {{
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  {handler_sig} {{
    e.preventDefault();
    setError("");
    setLoading(true);

    try {{
      // TODO: wire to your existing auth call.
      // If your previous page already had a submit handler, port it here.
      // For now, just no-op.
      await new Promise((r) => setTimeout(r, 250));
    }} catch (err) {{
      setError("Sign in failed.");
    }} finally {{
      setLoading(false);
    }}
  }}

  return (
    <div className="relative min-h-screen bg-black text-white">
      {{/* Background image (NO white haze) */}}
      <div className="absolute inset-0">
{img_bg.rstrip()}
        {{/* Hard black vignette to match the reference look */}}
        <div className="absolute inset-0 bg-black/55" />
        <div className="absolute inset-0 [background:radial-gradient(ellipse_at_center,rgba(0,0,0,0)_0%,rgba(0,0,0,0.55)_55%,rgba(0,0,0,0.9)_100%)]" />
      </div>

      <main className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 py-12">
        {{/* Large logo at top */}}
        <div className="mb-10 flex items-center justify-center">
{img_logo.rstrip()}
        </div>

        {{/* Glass login card */}}
        <section className="w-full max-w-[560px]">
          <div className="rounded-none border border-white/20 bg-black/55 backdrop-blur-[2px]">
            <div className="border-b border-white/15 px-10 py-6">
              <h1 className="text-3xl font-semibold tracking-tight">Secure sign in</h1>
            </div>

            <form onSubmit={{handleSubmit}} className="px-10 py-8">
              <label className="block text-sm text-white/70">Email</label>
              <input
                value={{email}}
                onChange={{(e) => setEmail(e.target.value)}}
                type="email"
                autoComplete="email"
                className="mt-2 w-full border border-white/15 bg-black/60 px-4 py-3 text-white outline-none focus:border-white/35"
              />

              <div className="mt-6">
                <label className="block text-sm text-white/70">Password</label>
                <input
                  value={{password}}
                  onChange={{(e) => setPassword(e.target.value)}}
                  type="password"
                  autoComplete="current-password"
                  className="mt-2 w-full border border-white/15 bg-black/60 px-4 py-3 text-white outline-none focus:border-white/35"
                />
              </div>

              {{error ? (
                <p className="mt-4 text-sm text-white/80">{{
                  error
                }}</p>
              ) : null}}

              <button
                type="submit"
                disabled={{loading}}
                className="mt-8 inline-flex items-center justify-center border border-white/25 bg-white/10 px-6 py-3 font-medium tracking-wide hover:bg-white/15 disabled:opacity-60"
              >
                {{loading ? "Signing in..." : "Sign in"}}
              </button>

              <p className="mt-8 text-sm text-white/45">
                Use your dealership-issued credentials.
              </p>
            </form>
          </div>
        </section>
      </main>
    </div>
  );
}}
"""

login_file.write_text(content, encoding="utf-8")
print(f"Rebuilt login page: {login_file}")
