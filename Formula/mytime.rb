class Mytime < Formula
  desc "Terminal task manager and calendar TUI with Google Calendar sync and agent CLI"
  homepage "https://github.com/alexapvl/mytime"
  license "MIT"
  version "0.1.2"

  depends_on "node@20"

  head do
    url "https://github.com/alexapvl/mytime.git", branch: "main"
  end

  # Slim prebuilt pack (dist + node_modules). Uses Homebrew node@20 — see scripts/build-macos-pack.sh.
  on_arm do
    url "https://github.com/alexapvl/mytime/releases/download/v0.1.2/mytime-0.1.2-macos-arm64.tar.gz"
    sha256 "7a4543a7bbcdf9d3b6e996cb61c42e3b4949a052d6cafa800be88adf3644ccb8"
  end

  on_intel do
    url "https://github.com/alexapvl/mytime/releases/download/v0.1.2/mytime-0.1.2-macos-x86_64.tar.gz"
    sha256 "674ef0ee3c014511c6f8ee1feef5e54401947aa35dc4ebc02a8765ad2a5ff3db"
  end

  def install
    if build.head?
      ENV.prepend_path "PATH", Formula["node@20"].opt_bin
      system "npm", "install"
      system "npm", "run", "build"
      libexec.install "dist", "node_modules", "package.json"
    else
      libexec.install Dir["libexec/*"]
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
