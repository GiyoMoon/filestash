import React, { useEffect, useState, useRef, useMemo } from "react";
import ReactCSSTransitionGroup from "react-addons-css-transition-group";
import filepath from "path";

import { Pager } from "./pager";
import { MenuBar } from "./menubar";
import { Chromecast } from "../../model/"
import { getMimeType,settings_get, settings_put, notify } from "../../helpers/";
import { t } from "../../locales/";
import { Icon } from "../../components/";
import hls from "hls.js";
import "./videoplayer.scss";

export function VideoPlayer({ filename, data, path }) {
    const $video = useRef();
    const $container = useRef();
    const [isPlaying, setIsPlaying] = useState(false);
    const [volume, setVolume] = useState(settings_get("volume") === null ? 50 : settings_get("volume"));
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isChromecast, setIsChromecast] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isBuffering, setIsBuffering] = useState(false);
    const [render, setRender] = useState(0);
    const [hint, setHint] = useState(null);
    const [videoSources, setVideoSources] = useState([]);

    useEffect(() => {
        if (!$video.current) return;
        const metadataHandler = () => {
            $video.current.volume = volume / 100;
            setDuration($video.current.duration);
            setIsLoading(false);
        };
        const finishHandler = () => {
            $video.current.currentTime = 0;
            setIsPlaying(false);
        };
        const errorHandler = (err) => {
            console.error(err);
            notify.send(t("Not supported"), "error");
            setIsPlaying(false);
            setIsLoading(false);
        };
        const waitingHandler = (e) => {
            setIsBuffering(true);
        }
        const playingHandler = (e) => {
            setIsBuffering(false);
        }
        if (!window.overrides["video-map-sources"]) {
            window.overrides["video-map-sources"] = (s) => (s);
        }
        const sources = window.overrides["video-map-sources"]([{
            src: data,
            type: getMimeType(data),
        }]);
        setVideoSources(sources.map((source) => {
            if (source.type !== "application/x-mpegURL" && source.type !== "application/vnd.apple.mpegurl") return source;
            const h = new hls();
            h.loadSource(source.src);
            h.attachMedia($video.current);
            return source;
        }));

        $video.current.addEventListener("loadeddata", metadataHandler);
        $video.current.addEventListener("ended", finishHandler);
        $video.current.addEventListener("error", errorHandler);
        $video.current.addEventListener("waiting", waitingHandler);
        $video.current.addEventListener("playing", playingHandler);

        let $sources = $video.current.querySelectorAll("source")
        for (let i=0; i<$sources.length; i++) {
            $sources[i].addEventListener("error", errorHandler);
        }
        return () => {
            $video.current.removeEventListener("loadeddata", metadataHandler);
            $video.current.removeEventListener("ended", finishHandler);
            $video.current.removeEventListener("error", errorHandler);
            $video.current.removeEventListener("waiting", waitingHandler);
            $video.current.removeEventListener("playing", playingHandler);
            for (let i=0; i<$sources.length; i++) {
                $sources[i].removeEventListener("error", errorHandler);
            }
        };
    }, [$video, data]);

    useEffect(() => {
        const resizeHandler = () => setRender(render + 1);
        const onKeyPressHandler = (e) => {
            if(e.code !== "Space") {
                return
            }
            isPlaying ? onPause(e) : onPlay(e);
        };
        window.addEventListener("resize", resizeHandler);
        window.addEventListener("keypress", onKeyPressHandler);
        return () => {
            window.removeEventListener("resize", resizeHandler);
            window.removeEventListener("keypress", onKeyPressHandler);
        };
    }, [render, isPlaying, isChromecast]);

    useEffect(() => {
        const context = Chromecast.context();
        if (!context) return;
        document.getElementById("chromecast-target").append(document.createElement("google-cast-launcher"));

        const chromecastSetup = (event) => {
            switch (event.sessionState) {
            case cast.framework.SessionState.SESSION_STARTING:
                setIsChromecast(true);
                setIsLoading(true);
                break;
            case cast.framework.SessionState.SESSION_START_FAILED:
                setIsChromecast(false);
                setIsLoading(false);
                break;
            case cast.framework.SessionState.SESSION_STARTED:
                chromecastLoader()
                break;
            case cast.framework.SessionState.SESSION_ENDING:
                setIsChromecast(false);
                $video.current.currentTime = _currentTime;
                $video.current.muted = false;
                if (isPlaying) $video.current.play();
                break;
            }
        };
        context.addEventListener(
            cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
            chromecastSetup,
        );
        return () => {
            const media = Chromecast.media();
            if (media) media.removeUpdateListener(chromecastMediaHandler);
            context.removeEventListener(
                cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
                chromecastSetup,
            );
        };
    }, []);

    useEffect(() => {
        const interval = setInterval(() => {
            if (isLoading) return;
            if (isChromecast) {
                const media = Chromecast.media();
                if (!media) return;
                _currentTime = media.getEstimatedTime();
                setIsBuffering(media.playerState === "BUFFERING");
            } else _currentTime = $video.current.currentTime;
            setCurrentTime(_currentTime)
        }, 100);
        return () => {
            clearInterval(interval);
        };
    }, [data, isChromecast, isLoading]);

    const onPlay = () => {
        setIsPlaying(true);
        if (isChromecast) {
            const media = Chromecast.media();
            if (media) media.play();
        } else $video.current.play();
    };
    const onPause = () => {
        setIsPlaying(false);
        if (isChromecast) {
            const media = Chromecast.media();
            if (media) media.pause();
        } else $video.current.pause();

    };
    const onSeek = (newTime) => {
        if (isChromecast) {
            const media = Chromecast.media();
            if (!media) return;
            setIsLoading(true);
            const seekRequest = new chrome.cast.media.SeekRequest();
            seekRequest.currentTime = parseInt(newTime);
            media.seek(seekRequest);
            setTimeout(() => setIsLoading(false), 1000);
        } else $video.current.currentTime = newTime;
    };
    const onClickSeek = (e) => {
        let $progress = e.target;
        if (e.target.classList.contains("progress") == false) {
            $progress = e.target.parentElement;
        }
        const rec = $progress.getBoundingClientRect();
        e.persist();
        let n = (e.clientX - rec.x) / rec.width;
        if (n < 2/100) {
            onPause();
            n = 0;
        }
        onSeek(n * duration);
    };

    const onVolumeChange = (n) => {
        settings_put("volume", n);
        setVolume(n);
        if (isChromecast) {
            const session = Chromecast.session()
            if (session) session.setVolume(n / 100);
            else notify.send(t("Cannot establish a connection"), "error");
        }
        else $video.current.volume = n / 100;
    };

    const onProgressHover = (e) => {
        const rec = e.target.getBoundingClientRect();
        const width = e.clientX - rec.x;
        const time = duration * width / rec.width;
        let posX = width;
        posX = Math.max(posX, 30) // min boundary
        posX = Math.min(posX, e.target.clientWidth - 30);
        setHint({ x: `${posX}px`, time })
    };

    const onRequestFullscreen = () => {
        const session = Chromecast.session();
        if (!session) {
            document.querySelector(".video_screen").requestFullscreen();
            requestAnimationFrame(() => setRender(render + 1));
        } else {
            chromecastLoader();
        }
    };

    const isFullscreen = () => {
        if (!$container.current) return false
        return window.innerHeight === screen.height;
    };

    const renderBuffer = () => {
        if (!$video.current) return null;
        const calcWidth = (i) => {
            return ($video.current.buffered.end(i) - $video.current.buffered.start(i)) / duration * 100;
        };
        const calcLeft = (i) => {
            return $video.current.buffered.start(i) / duration * 100;
        };
        return (
            <React.Fragment>
                {
                    Array.apply(null, { length: $video.current.buffered.length }).map((_, i) => (
                        <div className="progress-buffer" key={i} style={{left: calcLeft(i) + "%",  width: calcWidth(i) + "%" }} />
                    ))
                }
            </React.Fragment>
        );
    };
    const formatTimecode = (seconds) => {
        return String(parseInt(seconds / 60)).padStart(2, "0") +
            ":"+
            String(parseInt(seconds % 60)).padStart(2, "0");
    };

    const chromecastLoader = () => {
        const link = Chromecast.createLink(data);
        const media = new chrome.cast.media.MediaInfo(
            link,
            getMimeType(data),
        );
        media.metadata = new chrome.cast.media.MovieMediaMetadata()
        media.metadata.title = filename.substr(0, filename.lastIndexOf(filepath.extname(filename)));
        media.metadata.subtitle = CONFIG.name;
        media.metadata.images = [
            new chrome.cast.Image(origin + "/assets/icons/video.png"),
        ];

        setIsChromecast(true);
        setIsPlaying(true);
        setIsLoading(false);
        $video.current.muted = true;
        $video.current.pause();

        const session = Chromecast.session();
        if (!session) return;
        $video.current.pause();
        setVolume(session.getVolume() * 100);
        Chromecast.createRequest(media)
            .then((req) => {
                req.currentTime = parseInt($video.current.currentTime);
                setCurrentTime($video.current.currentTime);
                return session.loadMedia(req);
            })
            .then(() => {
                const media = session.getMediaSession();
                if (!media) return;
                media.addUpdateListener(chromecastMediaHandler);
            })
            .catch((err) => {
                console.error(err);
                notify.send(t("Cannot establish a connection"), "error");
            });
    };
    const chromecastMediaHandler = (isAlive) => {
        if (isAlive) return;
        const session = Chromecast.session();
        if (session) {
            session.endSession();
            $video.current.muted = false;
            setVolume($video.current.volume * 100);
            setIsChromecast(false);
            onSeek(0);
            onPause();
        }
    };

    return (
        <div className="component_videoplayer">
            <MenuBar title={filename} download={data} />
            <div className="video_container" ref={$container}>
                <ReactCSSTransitionGroup
                    transitionName="video"
                    transitionAppear={true}
                    transitionLeave={false}
                    transitionEnter={true}
                    transitionEnterTimeout={300}
                    transitionAppearTimeout={300}>
                    <div className={"video_screen" + (isPlaying ? " video-state-play" : " video-state-pause")}>
                        <div className="video_wrapper" style={isFullscreen() ? {
                                 maxHeight: "inherit",
                                 height: "inherit",
                             } : {
                                 maxHeight: (($container.current || {}).clientHeight - 100) || 0,
                             }}>
                            <video onClick={() => isPlaying ? onPause() : onPlay()} ref={$video}>
                                {
                                    videoSources.map((d, i) => (
                                        <source key={i} src={d.src} type={d.type} />
                                    ))
                                }
                            </video>
                        </div>
                        {
                            isLoading && (
                                <div className="loader no-select">
                                    <Icon name="loading" />
                                </div>
                            )
                        }
                        {
                            duration > 0 && (
                                <div className="videoplayer_control no-select">
                                    <div className="progress" onClick={onClickSeek} onMouseMove={onProgressHover} onMouseLeave={() => setHint(null)}>
                                        { isChromecast === false && renderBuffer() }
                                        <div className="progress-active" style={{width: (currentTime * 100 / (duration || 1)) + "%"}}>
                                            <div className="thumb" />
                                        </div>
                                        <div className="progress-placeholder"></div>
                                    </div>
                                    {
                                        isLoading || isBuffering ? (
                                            <Icon name="loading" />
                                        ) : isPlaying ? (
                                            <Icon name="pause" onClick={onPause} />
                                        ) : (
                                            <Icon name="play" onClick={onPlay} />
                                        )
                                    }
                                    <Icon name="volume" onClick={() => onVolumeChange(0)} name={volume === 0 ? "volume_mute" : volume < 50 ? "volume_low" : "volume"}/>
                                    <input type="range" onChange={(e) => onVolumeChange(Number(e.target.value))} value={volume} min="0" max="100" />
                                    <span className="timecode">
                                        { formatTimecode(currentTime) }
                                        &nbsp; / &nbsp;
                                        { formatTimecode(duration) }
                                        {
                                            hint && (
                                                <div className="hint" style={{left: hint.x}}>{ formatTimecode(hint.time) }</div>
                                            )
                                        }
                                    </span>
                                    <div className="pull-right">
                                        {
                                            <React.Fragment>
                                                <Icon name="fullscreen" onClick={onRequestFullscreen} />
                                            </React.Fragment>
                                        }
                                    </div>
                                </div>
                            )
                        }
                    </div>
                </ReactCSSTransitionGroup>
                <Pager path={path} />
            </div>
        </div>
    );
}

let _currentTime = 0; // trick to avoid making too many call to the chromecast SDK
