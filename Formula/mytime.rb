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
    sha256 "6d2c61deb5fbf721c2ff93661bf8f1c40cd179ce905f8e8da8f079d88fecc75b"
  end

  on_intel do
    url "https://github.com/alexapvl/mytime/releases/download/v0.1.2/mytime-0.1.2-macos-x86_64.tar.gz"
    sha256 "be48e5c3e654dbf4acc2789b860ef8a09cfd57e3164f44f1b9ec0fb7442ee2f8"
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
