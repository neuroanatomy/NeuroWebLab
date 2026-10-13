# NeuroWebLab
NeuroWebLab backend

Your portal for collaborative open neuroscience on the web.  

Come check out our vision [here](https://neuroweblab.github.io/).  

<img src="./images/Neuroweblab.png"></img>

## Yearly Node upgrade

All NAAT repos (NeuroWebLab, nwl-components, BrainBox, microdraw) run the current Node LTS, declared in each repo's `.nvmrc`. The workflow `.github/workflows/yearly-node-upgrade.yml` runs every 1 November. It finds the newest Node LTS on nodejs.org, checks that the unofficial `linux-x64-glibc-217` builds exist for it (the production servers run CentOS 7), and, if that LTS is newer than `.nvmrc`, opens an issue labelled `node-upgrade` with the checklist for the four repos and both servers (deadline: 1 May). It doesn't open a second issue while one is still open, and it only logs a line when the repos are already on the newest LTS.

- **Who gets assigned:** set the repository variable `NODE_UPGRADE_ASSIGNEES` to a comma-separated list of GitHub usernames (Settings → Secrets and variables → Actions → Variables). Assignees must be collaborators of this repo. If the variable is empty, the issue is opened unassigned and says so.
- **Run it by hand:** Actions → Yearly Node upgrade → Run workflow. "Dry run" is ticked by default: the log shows the issue it would open, and nothing is created. Untick it to open the issue now.
- **Locally:** `DRY_RUN=true node .github/scripts/yearly-node-upgrade.mjs` (add `NVMRC=<file containing an older major>` to see the issue text).
