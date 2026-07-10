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
    sha256 "f46f77f757417f6e7e40ccf48273b6bf8d25f11e07a2fdf924bebddd155fa063"
  end

  on_intel do
    url "https://github.com/alexapvl/mytime/releases/download/v0.1.1/mytime-0.1.1-macos-x86_64.tar.gz"
    sha256 "073a11e7dd1e40a564ef9cf069479dada366b51b6e2568ea9c88137a4e034d4d"
  end

  def install
    if build.head?
      ENV.prepend_path "PATH", Formula["node"].opt_bin
      system "npm", "install"
      system "npm", "run", "build"
      libexec.install "dist", "node_modules", "package.json"
      (bin/"mytime").write_env_script libexec/"dist/cli.js", PATH: "#{Formula["node"].opt_bin}:$PATH"
    else
      libexec.install Dir["libexec/*"]
      (bin/"mytime").write <<~EOS
        #!/bin/bash
        exec "#{libexec}/node/bin/node" --no-deprecation "#{libexec}/dist/cli.js" "$@"
      EOS
    end
  end

  test do
    assert_match "mytime", shell_output("#{bin}/mytime help")
  end
end
