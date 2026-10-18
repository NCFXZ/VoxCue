"""Write/read only the mounted DMG's Finder layout; never change user preferences."""
import json
import os
from pathlib import Path
import sys

mode, volume, layout_path, *wheels = sys.argv[1:]
sys.path[:0] = wheels
from ds_store import DSStore
from mac_alias import Alias

layout = json.loads(Path(layout_path).read_text())
background = Path(volume) / '.background' / 'background.tiff'
store = Path(volume) / '.DS_Store'
if mode == 'write':
    window = layout['window']
    with DSStore.open(str(store), 'w+') as data:
        data['.']['vSrn'] = ('long', 1)
        data['.']['icvl'] = ('type', b'icnv')
        data['.']['bwsp'] = {
            'WindowBounds': '{{%d, %d}, {%d, %d}}' % (window['x'], window['y'], window['width'], window['height']),
            'ContainerShowSidebar': False, 'PreviewPaneVisibility': False,
            'ShowSidebar': False, 'ShowToolbar': False, 'ShowStatusBar': False,
            'ShowPathbar': False, 'ShowTabView': False, 'SidebarWidth': 0,
        }
        data['.']['icvp'] = {
            'viewOptionsVersion': 1, 'backgroundType': 2,
            'backgroundColorRed': 1.0, 'backgroundColorGreen': 1.0, 'backgroundColorBlue': 1.0,
            'backgroundImageAlias': Alias.for_file(str(background)).to_bytes(),
            'gridOffsetX': 0.0, 'gridOffsetY': 0.0, 'gridSpacing': 100.0,
            'arrangeBy': 'none', 'showIconPreview': False, 'showItemInfo': False,
            'labelOnBottom': True, 'textSize': float(layout['textSize']),
            'iconSize': float(layout['iconSize']), 'scrollPositionX': 0.0, 'scrollPositionY': 0.0,
        }
        for key in ['application', 'destination']:
            item = layout[key]
            data[item['name']]['Iloc'] = (item['x'], item['y'])
elif mode == 'read':
    with DSStore.open(str(store), 'r') as data:
        icon_view = dict(data['.']['icvp'])
        alias = Alias.from_bytes(icon_view.pop('backgroundImageAlias'))
        print(json.dumps({
            'window': data['.']['bwsp'], 'iconView': icon_view,
            'positions': {layout[key]['name']: data[layout[key]['name']]['Iloc'] for key in ['application', 'destination']},
            'background': {'filename': alias.target.filename, 'bytes': background.stat().st_size},
            'destination': os.readlink(Path(volume) / layout['destination']['name']),
        }))
else:
    raise ValueError('Unknown DMG layout operation')
