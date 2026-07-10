class Mytime < Formula
  desc "Terminal task manager and calendar TUI with Google Calendar sync and agent CLI"
  homepage "https://github.com/alexapvl/mytime"
  head "https://github.com/alexapvl/mytime.git", branch: "main"

  depends_on "node@20"
  depends_on "pnpm"

  def install
    ENV.prepend_path "PATH", Formula["node@20"].opt_bin
    system "pnpm", "install", "--frozen-lockfile"
    system "pnpm", "build"
    libexec.install "dist", "node_modules", "package.json"
    bin.install libexec/"dist/cli.js" => "mytime"
  end

  test do
    assert_match "mytime", shell_output("#{bin}/mytime help")
  end
end
