Drop your transparent PNG overlays in this folder and register them in manifest.json.

Manifest format:
{
  "overlays": [
    {
      "id": "unique-id",
      "label": "Visible name",
      "src": "/overlays/file.png",
      "position": {
        "top": "0",
        "left": "0",
        "width": "100%",
        "height": "100%",
        "opacity": "1"
      }
    }
  ]
}

Allowed position keys: top, left, right, bottom, width, height, opacity.
