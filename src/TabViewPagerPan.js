/* @flow */

import React, { PureComponent, Children, PropTypes } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  StyleSheet,
} from 'react-native';
import TabViewStyleInterpolator from './TabViewStyleInterpolator';
import { PagerPropsPropType } from './TabViewPropTypes';
import type { PagerProps } from './TabViewTypeDefinitions';
import type { GestureEvent, GestureState } from './PanResponderTypes';

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
});

type TransitionProps = {
  progress: number;
}

type TransitionSpec = {
  timing: Function;
}

type TransitionConfigurator = (currentTransitionProps: TransitionProps, nextTransitionProps: TransitionProps) => ?TransitionSpec

type DefaultProps = {
  configureTransition: TransitionConfigurator;
  swipeDistanceThreshold: number;
  swipeVelocityThreshold: number;
}

type Props = PagerProps & {
  configureTransition: TransitionConfigurator;
  swipeEnabled?: boolean;
  swipeDistanceThreshold: number;
  swipeVelocityThreshold: number;
  children?: any;
}

const DefaultTransitionSpec = {
  timing: Animated.spring,
  tension: 300,
  friction: 35,
  useNativeDriver: true,
};

const DEAD_ZONE = 12;

export default class TabViewPagerPan extends PureComponent<DefaultProps, Props, void> {
  static propTypes = {
    ...PagerPropsPropType,
    configureTransition: PropTypes.func.isRequired,
    swipeEnabled: PropTypes.bool,
    swipeDistanceThreshold: PropTypes.number.isRequired,
    swipeVelocityThreshold: PropTypes.number.isRequired,
    children: PropTypes.node,
  };

  static defaultProps = {
    configureTransition: () => DefaultTransitionSpec,
    swipeDistanceThreshold: 120,
    swipeVelocityThreshold: 0.25,
  };

  static normalize = (props: PagerProps) => props.offset;

  componentWillMount() {
    this.props.offset.addListener(this._trackOffset);
    this._lastOffset = this.props.navigationState.index;
    this._panResponder = PanResponder.create({
      onMoveShouldSetPanResponder: this._canMoveScreen,
      onMoveShouldSetPanResponderCapture: this._canMoveScreen,
      onPanResponderGrant: this._startGesture,
      onPanResponderMove: this._respondToGesture,
      onPanResponderTerminate: this._finishGesture,
      onPanResponderRelease: this._finishGesture,
      onPanResponderTerminationRequest: () => true,
    });
  }

  componentWillReceiveProps(nextProps: Props) {
    if (this.props.layout !== nextProps.layout || Children.count(this.props.children) !== Children.count(nextProps.children)) {
      global.requestAnimationFrame(() =>
        this._transitionTo(this.props.navigationState.index, nextProps.navigationState.index)
      );
    }
  }

  componentDidUpdate(prevProps: Props) {
    global.requestAnimationFrame(() =>
      this._transitionTo(prevProps.navigationState.index, this.props.navigationState.index)
    );
  }

  componentWillUnmount() {
    this.props.offset.removeListener(this._trackOffset);
  }

  _panResponder: Object;
  _lastOffset: number;
  _lastValue = null;
  _isMoving = null;
  _startDirection = 0;

  _trackOffset = (e: { value: number }) => {
    this._lastOffset = e.value;
  };

  _transitionTo = (fromValue: number, toValue: number) => {
    const currentTransitionProps = {
      position: fromValue,
    };
    const nextTransitionProps = {
      position: toValue,
    };
    let transitionSpec;
    if (this.props.configureTransition) {
      transitionSpec = this.props.configureTransition(currentTransitionProps, nextTransitionProps);
    }
    if (transitionSpec) {
      const { timing, ...transitionConfig } = transitionSpec;
      timing(this.props.offset, {
        ...transitionConfig,
        toValue,
      }).start();
    } else {
      this.props.offset.setValue(toValue);
    }
  }

  _isIndexInRange = (index: number) => {
    const { routes } = this.props.navigationState;
    return (index >= 0 && index <= routes.length - 1);
  };

  _isMovingHorzontally = (evt: GestureEvent, gestureState: GestureState) => {
    return (
      (Math.abs(gestureState.dx) > Math.abs(gestureState.dy * 3)) &&
      (Math.abs(gestureState.vx) > Math.abs(gestureState.vy * 3))
    );
  };

  _isReverseDirection = (gestureState: GestureState) => {
    if (this._startDirection > 0) {
      return gestureState.vx < 0;
    } else {
      return gestureState.vx > 0;
    }
  };

  _getNextIndex = (evt: GestureEvent, gestureState: GestureState) => {
    const { index } = this.props.navigationState;

    let swipeVelocityThreshold = this.props.swipeVelocityThreshold;

    if (Platform.OS === 'android') {
      // on Android, velocity is way lower due to timestamp being in nanosecond
      // normalize it to have the same velocity on both iOS and Android
      swipeVelocityThreshold /= 1000000;
    }

    if (
      Math.abs(gestureState.dx) > this.props.swipeDistanceThreshold ||
      Math.abs(gestureState.vx) > swipeVelocityThreshold
    ) {
      const nextIndex = index - (gestureState.dx / Math.abs(gestureState.dx));
      if (this._isIndexInRange(nextIndex)) {
        return nextIndex;
      }
    }
    return index;
  };

  _canMoveScreen = (evt: GestureEvent, gestureState: GestureState) => {
    if (this.props.swipeEnabled === false) {
      return false;
    }
    const { navigationState: { routes, index } } = this.props;
    const canMove = this._isMovingHorzontally(evt, gestureState) && (
      (gestureState.dx >= DEAD_ZONE && index >= 0) ||
      (gestureState.dx <= -DEAD_ZONE && index <= routes.length - 1)
    );
    if (canMove) {
      this._startDirection = gestureState.dx;
    }
    return canMove;
  };

  _startGesture = () => {
    this.props.offset.stopAnimation(value => {
      this._lastValue = value;
    });
  };

  _respondToGesture = (evt: GestureEvent, gestureState: GestureState) => {
    const { layout: { width } } = this.props;
    const currentPosition = typeof this._lastValue === 'number' ? this._lastValue : this.props.navigationState.index;
    const nextPosition = currentPosition - (gestureState.dx / width);
    if (this._isMoving === null) {
      this._isMoving = this._isMovingHorzontally(evt, gestureState);
    }
    if (this._isMoving && this._isIndexInRange(nextPosition)) {
      this.props.offset.setValue(nextPosition);
    }
  };

  _finishGesture = (evt: GestureEvent, gestureState: GestureState) => {
    const currentIndex = this.props.navigationState.index;
    const currentValue = this._lastOffset;
    if (currentValue !== currentIndex) {
      if (this._isMoving && !this._isReverseDirection(gestureState)) {
        const nextIndex = this._getNextIndex(evt, gestureState);
        this.props.jumpToIndex(nextIndex);
      } else {
        this.props.jumpToIndex(currentIndex);
      }
    }
    this._lastValue = null;
    this._isMoving = null;
  };

  render() {
    const { navigationState, layout } = this.props;
    const { routes } = navigationState;

    const style = TabViewStyleInterpolator.forHorizontal(this.props);

    return (
      <Animated.View style={[ styles.sheet, style, { width: layout.width * routes.length } ]} {...this._panResponder.panHandlers}>
        {this.props.children}
      </Animated.View>
    );
  }
}
