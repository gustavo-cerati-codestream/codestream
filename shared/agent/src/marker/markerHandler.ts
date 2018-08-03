"use strict";

import { URL } from "url";
import { Range, TextDocumentIdentifier } from "vscode-languageserver";
import { DocumentMarkersRequest } from "../agent";
import { CSMarkerLocation } from "../api/api";
import { StreamUtil } from "../git/streamUtil";
import { MarkerLocationUtil } from "../markerLocation/markerLocationUtil";
import { MarkerUtil } from "./markerUtil";

export namespace MarkerHandler {
	const emptyResponse = {
		markers: []
	};

	export async function handle(
		document: TextDocumentIdentifier
	): Promise<DocumentMarkersRequest.Response> {
		try {
			const filePath = new URL(document.uri).pathname;

			// const repoId = RepoUtil.getRepoId(filePath);

			debugger;
			const streamId = await StreamUtil.getStreamId(filePath);
			if (!streamId) {
				return emptyResponse;
			}

			const markers = await MarkerUtil.getMarkers(streamId);
			const locations = await MarkerLocationUtil.getCurrentLocations(document.uri);

			const markersWithRange = [];
			for (const marker of markers) {
				markersWithRange.push({
					id: marker.id,
					range: locationToRange(locations[marker.id])
				});
			}

			return {
				markers: markersWithRange
			};
		} catch (err) {
			console.error(err);
			debugger;
			return emptyResponse;
		}
	}
}

function locationToRange(location: CSMarkerLocation): Range {
	return {
		start: {
			line: location.lineStart - 1,
			character: location.colStart - 1
		},
		end: {
			line: location.lineEnd - 1,
			character: location.colEnd - 1
		}
	};
}
