class Mytime < Formula
  desc "Terminal task manager with Google and Apple Calendar sync and agent CLI"
  homepage "https://github.com/alexapvl/mytime"
  version "0.3.1"
  license "MIT"

  head "https://github.com/alexapvl/mytime.git", branch: "main"

  depends_on macos: :sonoma
  depends_on "node@20"

  # Slim prebuilt pack (dist + node_modules). Uses Homebrew node@20. See scripts/build-macos-pack.sh.
  on_macos do
    on_arm do
      url "https://github.com/alexapvl/mytime/releases/download/v0.3.1/mytime-0.3.1-macos-arm64.tar.gz"
      sha256 "75bee2db372bf4a0180615bef4812183bc3ec5682bd87eec27f686c829209b2e"
    end

    on_intel do
      url "https://github.com/alexapvl/mytime/releases/download/v0.3.1/mytime-0.3.1-macos-x86_64.tar.gz"
      sha256 "21ef33175936a53220bc9393be57dade7f0c5a50683e25e7da79a497b87e2a4a"
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
