class Mytime < Formula
  desc "Terminal task manager and calendar TUI with Google Calendar sync and agent CLI"
  homepage "https://github.com/alexapvl/mytime"
  license "MIT"
  version "0.1.1"

  head do
    url "https://github.com/alexapvl/mytime.git", branch: "main"
    depends_on "node"
  end

  # Prebuilt standalone pack (vendored Node + prod deps). See scripts/build-macos-pack.sh and release CI.
  on_arm do
    url "https://github.com/alexapvl/mytime/releases/download/v0.1.1/mytime-0.1.1-macos-arm64.tar.gz"
    sha256 "1ee9a0faf7c9c6ffab46b76ad917213b64def2cfa2df4063fa36f1ed6b1e8b1c"
  end

  # Add on_intel with x86_64 pack + sha256 after release CI publishes mytime-*-macos-x86_64.tar.gz

  def install
    if build.head?
      ENV.prepend_path "PATH", Formula["node"].opt_bin
      system "npm", "install"
      system "npm", "run", "build"
      libexec.install "dist", "node_modules", "package.json"
      (bin/"mytime").write_env_script libexec/"dist/cli.js", PATH: "#{Formula["node"].opt_bin}:$PATH"
    else
      libexec.install Dir["libexec/*"]
      bin.install "bin/mytime"
    end
  end

  test do
    assert_match "mytime", shell_output("#{bin}/mytime help")
  end
end
