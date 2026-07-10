class Mytime < Formula
  desc "Terminal task manager and calendar TUI with Google Calendar sync and agent CLI"
  homepage "https://github.com/alexapvl/mytime"
  license "MIT"
  version "0.1.4"

  depends_on "node@20"

  head do
    url "https://github.com/alexapvl/mytime.git", branch: "main"
  end

  # Slim prebuilt pack (dist + node_modules). Uses Homebrew node@20 — see scripts/build-macos-pack.sh.
  on_arm do
    url "https://github.com/alexapvl/mytime/releases/download/v0.1.4/mytime-0.1.4-macos-arm64.tar.gz"
    sha256 "10cd6a6a1b02ebf4b75261a47defffc6a4d891565ed6e2470896aad1d900b93a"
  end

  on_intel do
    url "https://github.com/alexapvl/mytime/releases/download/v0.1.4/mytime-0.1.4-macos-x86_64.tar.gz"
    sha256 "62556ad4cf879c4ec7a3d9c7682af46dc290c3c906e2134ede83aba499f67df3"
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
