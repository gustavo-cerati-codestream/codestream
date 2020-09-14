import React, { useMemo, useCallback, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import * as userSelectors from "../store/users/reducer";
import * as providerSelectors from "../store/providers/reducer";
import { CodeStreamState } from "../store";
import { Row } from "./CrossPostIssueControls/IssueDropdown";
import Icon from "./Icon";
import { PRHeadshot } from "../src/components/Headshot";
import { H4, WideStatusSection, RoundedLink } from "./StatusPanel";
import { setCurrentReview, setCurrentPullRequest } from "../store/context/actions";
import Tooltip from "./Tooltip";
import Timestamp from "./Timestamp";
import { isConnected } from "../store/providers/reducer";
import { HostApi } from "../webview-api";
import {
	ReposScm,
	GetMyPullRequestsResponse,
	ExecuteThirdPartyRequestUntypedType,
	QueryThirdPartyRequestType
} from "@codestream/protocols/agent";
import { OpenUrlRequestType } from "@codestream/protocols/webview";
import { Button } from "../src/components/Button";
import { getMyPullRequests } from "../store/providerPullRequests/actions";
import { PRBranch } from "./PullRequestComponents";
import { PRHeadshotName } from "../src/components/HeadshotName";
import styled from "styled-components";
import Tag from "./Tag";
import { connectProvider, setUserPreference } from "./actions";
import { PROVIDER_MAPPINGS } from "./CrossPostIssueControls/types";
import { confirmPopup } from "./Confirm";
import { ConfigurePullRequestQuery } from "./ConfigurePullRequestQuery";
import { DEFAULT_QUERIES } from "../store/preferences/reducer";
import { ConfigurePullRequestQuerySettings } from "./ConfigurePullRequestQuerySettings";
import { usePrevious } from "../utilities/hooks";

const PRSummaryName = styled.div`
	padding: 2px 20px;
	display: flex;
	cursor: pointer;
	> .icon {
		display: inline-block;
		width: 16px;
		text-align: center;
	}
	&:hover {
		background: var(--app-background-color-hover);
		color: var(--text-color-highlight);
		.actions .icon {
			opacity: 1;
		}
	}
`;
const PRSummaryGroup = styled.div`
	${Row} {
		padding-left: 40px;
		.selected-icon {
			left: 20px;
		}
	}
	.actions {
		margin-left: auto;
		display: none;
		.icon {
			margin: 0 5px;
			opacity: 0.7;
		}
	}
	&:hover .actions {
		display: block;
	}
`;

export const PullRequestTooltip = (props: { pr: GetMyPullRequestsResponse }) => {
	const { pr } = props;
	const statusIcon =
		pr.isDraft || pr.state === "OPEN" || pr.state === "CLOSED" ? "pull-request" : "git-merge";

	const color = pr.isDraft
		? "gray"
		: pr.state === "OPEN"
		? "green"
		: pr.state === "MERGED"
		? "purple"
		: pr.state === "CLOSED"
		? "red"
		: "blue";

	return (
		<div>
			<div style={{ maxWidth: "400px", padding: "10px" }}>
				{pr.headRepository.nameWithOwner} <Timestamp time={pr.createdAt} relative />
				<div style={{ marginTop: "10px" }}>
					<div style={{ display: "flex" }}>
						<Icon
							name={statusIcon}
							className={`margin-right ${color}-color`}
							style={{ marginTop: "2px" }}
						/>
						<div>
							<span style={{ fontSize: "larger" }}>
								<span className="highlight">{pr.title}</span>{" "}
								<span className="subtle">#{pr.number}</span>
							</span>
							<div className="subtle" style={{ margin: "2px 0 10px 0", fontSize: "larger" }}>
								{pr.bodyText.substr(0, 300)}
							</div>
							<div className="monospace" style={{ fontSize: "smaller" }}>
								<PRBranch>{pr.baseRefName}&nbsp;</PRBranch>
								<span style={{ verticalAlign: "3px" }}>
									<Icon name="arrow-left" />
								</span>
								<PRBranch>&nbsp;{pr.headRefName}</PRBranch>
							</div>
						</div>
					</div>
				</div>
			</div>
			<div
				style={{
					margin: "5px -5px 0 -5px",
					padding: "15px 15px 0 15px",
					borderTop: "1px solid rgba(0, 0, 0, 0.1)"
				}}
			>
				<PRHeadshotName person={pr.author} size={16} />
				opened
			</div>
		</div>
	);
};

const ConnectToCodeHost = styled.div`
	margin: 10px 20px 0 20px;
	button {
		margin: 0 10px 10px 0;
	}
`;

interface Props {
	openRepos: ReposScm[];
}

export function OpenPullRequests(props: Props) {
	const dispatch = useDispatch();
	const derivedState = useSelector((state: CodeStreamState) => {
		const { session, preferences } = state;

		const currentUserId = session.userId!;
		const repos = props.openRepos.map(repo => {
			const id = repo.id || "";
			return { ...repo, name: state.repos[id] ? state.repos[id].name : "" };
		});

		const queries = preferences.pullRequestQueries || DEFAULT_QUERIES;

		// FIXME hardcoded github
		const hasPRSupportedRepos = repos.filter(r => r.providerGuess === "github").length > 0;

		const prSupportedProviders = providerSelectors.getSupportedPullRequestHosts(state);
		const prConnectedProviders = prSupportedProviders.filter(_ => isConnected(state, { id: _.id }));

		console.warn("PREFS: ", preferences);
		return {
			queries,
			teamTagsHash: userSelectors.getTeamTagsHash(state),
			repos,
			currentUserId,
			isPRSupportedCodeHostConnected: prConnectedProviders.length > 0,
			hasPRSupportedRepos,
			openReposOnly: !preferences.pullRequestQueryShowAllRepos,
			showLabels: !preferences.pullRequestQueryHideLabels,
			PRSupportedProviders: prSupportedProviders,
			PRConnectedProviders: prConnectedProviders
		};
	});

	const { queries } = derivedState;

	const [loadFromUrlQuery, setLoadFromUrlQuery] = React.useState("");
	const [loadFromUrlOpen, setLoadFromUrlOpen] = React.useState(false);

	const [pullRequestGroups, setPullRequestGroups] = React.useState<{
		[providerId: string]: GetMyPullRequestsResponse[][];
	}>({});
	const [isLoadingPRs, setIsLoadingPRs] = React.useState(false);
	const [isLoadingPRGroup, setIsLoadingPRGroup] = React.useState<number | undefined>(undefined);
	const [editingQuery, setEditingQuery] = React.useState<
		{ providerId: string; index: number } | undefined
	>(undefined);
	const [configureQuerySettings, setConfigureQuerySettings] = React.useState(false);
	const previousConfigureQuerySettings = usePrevious(configureQuerySettings);
	const setQueries = (providerId, queries) => {
		console.warn("SETTING QUERIES: ", queries);
		dispatch(setUserPreference(["pullRequestQueries", providerId], [...queries]));
		// dispatch(setUserPreference(["pullRequestQueries"], null));
	};

	useEffect(() => {
		// if previously we were editing... and now we're not fetch the PRs...
		if (previousConfigureQuerySettings && !configureQuerySettings) {
			fetchPRs(derivedState.queries, { force: true });
		}
	}, [derivedState.openReposOnly, derivedState.showLabels]);

	const fetchPRs = useCallback(
		async (theQueries, options?: { force?: boolean }) => {
			setIsLoadingPRs(true);
			try {
				const newGroups = {};
				console.warn("Loading the PRs...", theQueries);
				for (const connectedProvider of derivedState.PRConnectedProviders) {
					const queryStrings = (theQueries[connectedProvider.id] || []).map(_ => _.query);
					console.warn("Loading the PRs... in the loop", queryStrings);
					try {
						const response: any = await dispatch(
							getMyPullRequests(
								connectedProvider.id,
								queryStrings,
								derivedState.openReposOnly,
								options,
								true
							)
						);
						if (response && response.length) {
							let count = 0;
							response.forEach(group => (count += group.length));
							HostApi.instance.track("PR List Rendered", {
								"PR Count": count
							});
							console.warn("GOT SOME PULLS BACK: ", response);
							newGroups[connectedProvider.id] = response;
						}
					} catch (ex) {
						console.error(ex);
					}
				}
				console.warn("SETTING TO: ", newGroups);
				setPullRequestGroups(newGroups);
			} catch (ex) {
				console.error(ex);
				// if (ex && ex.indexOf('"message":"Bad credentials"') > -1) {
				// 	// show message about re-authing?
				// }
			} finally {
				setIsLoadingPRs(false);
			}
		},
		[
			editingQuery,
			configureQuerySettings,
			derivedState.PRConnectedProviders,
			derivedState.openReposOnly
		]
	);

	useMemo(() => {
		if (derivedState.isPRSupportedCodeHostConnected) {
			fetchPRs(queries);
		}
	}, [derivedState.isPRSupportedCodeHostConnected]);

	const addQuery = () => editQuery("", -1);
	const editQuery = (providerId: string, index: number) => {
		setEditingQuery({ providerId, index });
	};
	const reloadQuery = async (providerId, index) => {
		setIsLoadingPRGroup(index);
		try {
			const q = queries[providerId][index];
			const response: any = await dispatch(
				getMyPullRequests(providerId, [q.query], derivedState.openReposOnly, { force: true }, true)
			);
			if (response && response.length) {
				const newGroups = { ...pullRequestGroups };
				newGroups[providerId][index] = response[0];
				setPullRequestGroups(newGroups);
			}
		} catch (ex) {
			console.error(ex);
			//if (ex && ex.indexOf('"message":"Bad credentials"') > -1) {
			// show message about re-authing?
			//}
		} finally {
			setIsLoadingPRGroup(undefined);
		}
	};

	const deleteQuery = (providerId, index) => {
		confirmPopup({
			title: "Are you sure?",
			message: "Do you want to delete this query?" + index,
			centered: true,
			buttons: [
				{ label: "Go Back", className: "control-button" },
				{
					label: "Delete Query",
					className: "delete",
					action: async () => {
						console.warn("DELETING INDEX: ", index);
						console.warn("OLD VALUE IS: ", queries[providerId]);
						const newQueries = [...queries[providerId]];
						newQueries.splice(index, 1);
						console.warn("NEW VALUE IS: ", newQueries);
						setQueries(providerId, newQueries);
						const newGroups = [...pullRequestGroups[providerId]];
						newGroups.splice(index, 1);
						setPullRequestGroups({ ...pullRequestGroups, providerId: newGroups });
					}
				}
			]
		});
	};
	const toggleQueryHidden = (providerId, index) => {
		const newQueries = [...queries[providerId]];
		newQueries[index].hidden = !newQueries[index].hidden;
		setQueries(providerId, newQueries);
	};

	const save = (providerId: string, name: string, query: string) => {
		// FIXME hard-coded github
		const newQuery = {
			providerId,
			name,
			query,
			hidden: false
		};
		let newQueries = [...queries[providerId]];
		if (editingQuery && editingQuery.index !== undefined && editingQuery.index > -1) {
			// it's an edit
			newQueries[editingQuery.index] = newQuery;
		} else {
			// it's new
			newQueries = [...newQueries, newQuery];
		}
		setQueries(providerId, newQueries);
		setEditingQuery(undefined);
		fetchPRs({ ...queries, [providerId]: newQueries }, { force: true });
	};

	const goPR = async (url: string) => {
		HostApi.instance
			.send(QueryThirdPartyRequestType, {
				url: url
			})
			.then((providerInfo: any) => {
				if (providerInfo && providerInfo.providerId) {
					HostApi.instance
						.send(ExecuteThirdPartyRequestUntypedType, {
							method: "getPullRequestIdFromUrl",
							providerId: providerInfo.providerId,
							params: { url }
						})
						.then(id => {
							if (id) {
								dispatch(setCurrentReview(""));
								dispatch(setCurrentPullRequest(providerInfo.providerId, id as string));
							} else {
								HostApi.instance.send(OpenUrlRequestType, {
									url
								});
							}
						});
				} else {
					HostApi.instance.send(OpenUrlRequestType, {
						url
					});
				}
			})
			.catch(e => {
				HostApi.instance.send(OpenUrlRequestType, {
					url
				});
			});
	};

	if (!derivedState.isPRSupportedCodeHostConnected && !derivedState.hasPRSupportedRepos)
		return null;
	return (
		<>
			{editingQuery && (
				<ConfigurePullRequestQuery
					query={
						editingQuery.providerId
							? queries[editingQuery.providerId][editingQuery.index]
							: undefined
					}
					save={save}
					onClose={() => setEditingQuery(undefined)}
					openReposOnly={derivedState.openReposOnly}
					prConnectedProviders={derivedState.PRConnectedProviders}
				/>
			)}
			{configureQuerySettings && (
				<ConfigurePullRequestQuerySettings onClose={() => setConfigureQuerySettings(false)} />
			)}
			{(derivedState.isPRSupportedCodeHostConnected || derivedState.hasPRSupportedRepos) && (
				<WideStatusSection>
					<div className="filters" style={{ padding: "0 20px 0 20px" }}>
						<RoundedLink onClick={() => setConfigureQuerySettings(true)}>
							<Icon name="gear" />
							<span className="wide-text">&nbsp;Configure</span>
						</RoundedLink>
						<RoundedLink onClick={addQuery}>
							<Icon name="plus" />
							<span className="wide-text">&nbsp;Add Query</span>
						</RoundedLink>
						<RoundedLink onClick={() => fetchPRs(queries, { force: true })}>
							<Icon name="refresh" className={`spinnable ${isLoadingPRs ? "spin" : ""}`} />
							<span className="wide-text">&nbsp;Refresh</span>
						</RoundedLink>
						<H4>
							Pull Requests <sup className="subtle">(beta)</sup>
						</H4>
					</div>
					{derivedState.hasPRSupportedRepos && !derivedState.isPRSupportedCodeHostConnected && (
						<ConnectToCodeHost>
							{derivedState.PRSupportedProviders.map(provider => {
								const providerDisplay = PROVIDER_MAPPINGS[provider.name];
								if (providerDisplay) {
									return (
										<Button onClick={() => dispatch(connectProvider(provider.id, "Status"))}>
											<Icon name={providerDisplay.icon} />
											Connect to {providerDisplay.displayName} to see your PRs
										</Button>
									);
								} else return null;
							})}
						</ConnectToCodeHost>
					)}
					{derivedState.PRConnectedProviders.map(connectedProvider => {
						const providerId = connectedProvider.id;
						const providerQueries = queries[providerId] || [];
						return providerQueries.map((query, index) => {
							const providerGroups = pullRequestGroups[providerId];
							const prGroup = providerGroups && providerGroups[index];
							return (
								<PRSummaryGroup key={index}>
									<PRSummaryName onClick={() => toggleQueryHidden(providerId, index)}>
										{isLoadingPRs || index === isLoadingPRGroup ? (
											<Icon name="sync" className="spin" />
										) : (
											<Icon
												name={query.hidden ? "chevron-right" : "chevron-down"}
												className="chevron"
											/>
										)}
										<span>{query.name}</span>
										<div className="actions" onClick={e => e.stopPropagation()}>
											<Icon
												title="Reload Query"
												delay={0.5}
												placement="bottom"
												name="refresh"
												className="clickable"
												onClick={() => reloadQuery(providerId, index)}
											/>
											<Icon
												title="Edit Query"
												delay={0.5}
												placement="bottom"
												name="pencil"
												className="clickable"
												onClick={() => editQuery(providerId, index)}
											/>
											<Icon
												title="Delete Query"
												delay={0.5}
												placement="bottom"
												name="x"
												className="clickable"
												onClick={() => deleteQuery(providerId, index)}
											/>
										</div>
									</PRSummaryName>
									{!query.hidden &&
										prGroup &&
										prGroup.map((pr, index) => {
											const selected = derivedState.repos.find(repo => {
												return (
													repo.currentBranch === pr.headRefName &&
													repo.name === pr.headRepository.name
												);
											});
											return (
												<Tooltip
													key={"pr-tt-" + pr.id + index}
													title={<PullRequestTooltip pr={pr} />}
													delay={1}
													placement="top"
												>
													<Row
														key={"pr-" + pr.id}
														className={selected ? "selected" : ""}
														onClick={() => dispatch(setCurrentPullRequest(pr.providerId, pr.id))}
													>
														<div>
															{selected && <Icon name="arrow-right" className="selected-icon" />}
															<PRHeadshot person={pr.author} />
														</div>
														<div>
															<span>
																{pr.title} #{pr.number}
															</span>
															{pr.labels && pr.labels.nodes.length > 0 && derivedState.showLabels && (
																<span className="cs-tag-container">
																	{pr.labels.nodes.map((_, index) => (
																		<Tag
																			key={index}
																			tag={{ label: _.name, color: `#${_.color}` }}
																		/>
																	))}
																</span>
															)}
															<span className="subtle">{pr.bodyText || pr.body}</span>
														</div>
														<div className="icons">
															<span
																onClick={e => {
																	e.preventDefault();
																	e.stopPropagation();
																	HostApi.instance.send(OpenUrlRequestType, {
																		url: pr.url
																	});
																}}
															>
																<Icon
																	name="globe"
																	className="clickable"
																	title="View on GitHub"
																	placement="bottomLeft"
																	delay={1}
																/>
															</span>
															<Icon
																name="review"
																className="clickable"
																title="Review Changes"
																placement="bottomLeft"
																delay={1}
															/>
															<Timestamp time={pr.createdAt} relative abbreviated />
														</div>
													</Row>
												</Tooltip>
											);
										})}
								</PRSummaryGroup>
							);
						});
					})}
					<Row
						key="load"
						className={loadFromUrlOpen ? "no-hover" : ""}
						onClick={() => {
							setLoadFromUrlOpen(true);
							document.getElementById("pr-search-input")!.focus();
						}}
					>
						<div>
							<Icon name="link" />
						</div>
						<div>
							<input
								id="pr-search-input"
								placeholder="Load PR from URL"
								type="text"
								style={{ background: "transparent", width: "100%" }}
								value={loadFromUrlQuery}
								onChange={e => setLoadFromUrlQuery(e.target.value)}
								onKeyDown={e => {
									if (e.key == "Escape") {
										setLoadFromUrlQuery("");
									}
									if (e.key == "Enter") {
										goPR(loadFromUrlQuery);
									}
								}}
								onBlur={e => setLoadFromUrlOpen(false)}
							/>
						</div>
						{(loadFromUrlQuery || loadFromUrlOpen) && (
							<div className="go-pr">
								<Button className="go-pr" size="compact" onClick={() => goPR(loadFromUrlQuery)}>
									Go
								</Button>
							</div>
						)}
					</Row>
				</WideStatusSection>
			)}
		</>
	);
}