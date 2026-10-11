# AION2 map data example

> **Educational purposes only.** This repository is a study of the AION2 client's map data. It is
> not affiliated with or endorsed by NCSOFT; AION2 names, artwork and fonts belong to their
> owners. It does not connect to the game or to any official service.

An interactive, standalone map of AION2 regions built from decoded client placements: gathering
nodes, monsters, NPCs, Empyrean Traces and zones, drawn at their exact client coordinates.

```bat
Build-Deploy-Website.bat              rem Windows: test, build, serve and open the map
                                      rem (offers to download Node.js if it is missing)
```

```bash
bash Build-Deploy-Website.sh          # Linux, Node.js 22+
```

Then open http://127.0.0.1:4179/. Details, filters, deployment and the rebuild steps are in
[`tools/aion2-map-viewer/README.md`](tools/aion2-map-viewer/README.md).

Related: [Aion2_Client_Decoding](https://github.com/SemaAlter/Aion2_Client_Decoding) (client data
extraction) and [Aion2_Server_Example](https://github.com/SemaAlter/Aion2_Server_Example) (local
server).
