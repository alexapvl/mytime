class Mytime < Formula
  desc "Terminal task manager and calendar TUI with Google Calendar sync and agent CLI"
  homepage "https://github.com/alexapvl/mytime"
  url "https://github.com/alexapvl/mytime/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "c57f11cea4dffe692c53cbb0e35799d2b70ccf1da83112181f8891c4bc374486"
  license "MIT"
  version "0.1.0"

  head "https://github.com/alexapvl/mytime.git", branch: "main"

  depends_on "node"

  def install
    ENV.prepend_path "PATH", Formula["node"].opt_bin
    system "npm", "install"
    system "npm", "run", "build"
    libexec.install "dist", "node_modules", "package.json"
    (bin/"mytime").write_env_script libexec/"dist/cli.js", PATH: "#{Formula["node"].opt_bin}:$PATH"
  end

  test do
    assert_match "mytime", shell_output("#{bin}/mytime help")
  end
end
