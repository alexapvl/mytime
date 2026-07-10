class Mytime < Formula
  desc "Terminal task manager and calendar TUI with Google Calendar sync and agent CLI"
  homepage "https://github.com/alexapvl/mytime"
  license "MIT"
  version "0.1.3"

  depends_on "node@20"

  head do
    url "https://github.com/alexapvl/mytime.git", branch: "main"
  end

  # Slim prebuilt pack (dist + node_modules). Uses Homebrew node@20 — see scripts/build-macos-pack.sh.
  on_arm do
    url "https://github.com/alexapvl/mytime/releases/download/v0.1.3/mytime-0.1.3-macos-arm64.tar.gz"
    sha256 "5191aa821d451ba40704de5ee71884ba439a9b05ba9654ffb38bf9fcb20bfcce"
  end

  on_intel do
    url "https://github.com/alexapvl/mytime/releases/download/v0.1.3/mytime-0.1.3-macos-x86_64.tar.gz"
    sha256 "704756c723f6ed15d3279d4c95de88e54325283ab735d0ed3c02a916f747b3ac"
  end

  def install
    if build.head?
      ENV.prepend_path "PATH", Formula["node@20"].opt_bin
      system "npm", "install"
      system "npm", "run", "build"
      libexec.install "dist", "node_modules", "package.json"
    else
      libexec.install "dist", "node_modules"
      cd libexec do
        system Formula["node@20"].opt_bin/"npm", "rebuild", "better-sqlite3"
      end
    end

    (bin/"mytime").write_env_script libexec/"dist/cli.js", PATH: "#{Formula["node@20"].opt_bin}:$PATH"
  end

  test do
    assert_match "mytime", shell_output("#{bin}/mytime help")
  end
end
