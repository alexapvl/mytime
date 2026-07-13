class Mytime < Formula
  desc "Terminal task manager and calendar TUI with Google Calendar sync and agent CLI"
  homepage "https://github.com/alexapvl/mytime"
  version "0.1.5"
  license "MIT"

  head "https://github.com/alexapvl/mytime.git", branch: "main"

  depends_on "node@20"

  # Slim prebuilt pack (dist + node_modules). Uses Homebrew node@20 — see scripts/build-macos-pack.sh.
  on_macos do
    on_arm do
      url "https://github.com/alexapvl/mytime/releases/download/v0.1.5/mytime-0.1.5-macos-arm64.tar.gz"
      sha256 "a85e44563e412fa8e4944243e18117ca92b4266c5e00ce1cefb99004a18cae5e"
    end

    on_intel do
      url "https://github.com/alexapvl/mytime/releases/download/v0.1.5/mytime-0.1.5-macos-x86_64.tar.gz"
      sha256 "36187deaab176819f03b1d1ce7e3cc4bcce86a1363bcd69fa21a0cae73ab1008"
    end
  end

  def install
    if build.head?
      ENV.prepend_path "PATH", formula_opt_bin("node@20")
      system "npm", "install", *std_npm_args(prefix: false, ignore_scripts: false)
      system "npm", "run", "build"
      libexec.install "dist", "node_modules", "package.json"
    else
      libexec.install "dist", "node_modules"
      cd libexec do
        system formula_opt_bin("node@20")/"npm", "rebuild", "better-sqlite3"
      end
    end

    (bin/"mytime").write_env_script libexec/"dist/cli.js", PATH: "#{formula_opt_bin("node@20")}:$PATH"
  end

  def caveats
    <<~EOS
      For AI agent support, install the recommended mytime skill:
        npx skills add https://github.com/alexapvl/mytime --skill mytime -g

      Then print the agent onboarding prompt with:
        mytime setup --agent-onboarding-prompt
    EOS
  end

  test do
    assert_match "mytime", shell_output("#{bin}/mytime help")
  end
end
