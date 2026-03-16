Set-Location -LiteralPath 'C:\Users\barns\Desktop\Projects\Trading View'
Write-Output '--- git status ---'
git status --porcelain
Write-Output '--- git remote -v ---'
git remote -v
Write-Output '--- git add README.md ---'
git add README.md 2>&1
Write-Output '--- git commit ---'
 = git commit -m 'docs: add README' 2>&1
if (0 -eq 0) { Write-Output 'COMMIT_OK'; Write-Output  } else { Write-Output 'COMMIT_FAILED'; Write-Output  }
Write-Output '--- git push ---'
 = git push origin HEAD 2>&1
Write-Output 
